/**
 * The per-turn pipeline (SPEC §3):
 *   ① UNDERSTAND → ② REMEMBER → ③ GATE (cascade) → ④ TRANSITION → ⑤ RESPOND → ⑥ FILTER
 * Code owns every decision about phase and data; the Llm only proposes a
 * typed Understanding and writes the reply text.
 */
import { findPolicyholder } from "@/apps/insurance_claims/data";
import { PERSONA, RULES, SAFE_VERIFY_FALLBACK, STEP_SUMMARY, ENDED_MESSAGE, TRANSFERRED_MESSAGE } from "@/apps/insurance_claims/prompts/respond";
import { fitsHints, hasAnyHint } from "@/lib/domain/case-match";
import { renderEmail, type EmailSummary } from "@/lib/domain/email-summary";
import { backfillIdentity } from "@/lib/domain/pii-extract";
import { deadlineInfo, joinDocuments } from "@/lib/domain/guidance";
import type { Llm } from "@/lib/llm/types";
import { endConversation, getClaimDetail, sendEmailSummary, transferToHuman } from "@/lib/tools";
import { addTrace } from "@/lib/trace";
import { buildDirectives } from "./directives";
import { groundingCheck, leakCheck } from "./filter";
import { GATE_FOR, type Missing } from "./gates";
import { mergeUnderstanding, newCaseHints, resetIdentity } from "./memory";
import { chooseProcessPath, visibleData, type ProcessContext } from "./phases";
import { applyScope, emotionDirective, type BlockingGate, type ScopeOutcome } from "./policies";
import type { Session } from "./session";
import { NEXT, TERMINAL, transition, type Phase } from "./state-machine";

export class SessionBusy extends Error {}

export type TurnResult = { reply: string };

type Snapshot = Pick<Session, "turn" | "phase" | "phaseHistory" | "memory" | "transcript" | "outbox" | "endReason">;

function snapshot(s: Session): Snapshot {
  return structuredClone({
    turn: s.turn,
    phase: s.phase,
    phaseHistory: s.phaseHistory,
    memory: s.memory,
    transcript: s.transcript,
    outbox: s.outbox,
    endReason: s.endReason,
  });
}

function restore(s: Session, snap: Snapshot) {
  Object.assign(s, snap);
}

function blockingGate(phase: Phase, missing: Missing | null): BlockingGate {
  if (!missing) return null;
  if (missing.kind === "identity" || missing.kind === "rep_details") return "VERIFY_ID";
  if (missing.kind === "consent_pending") return "REP_CONSENT";
  if (missing.kind === "email_decision") return "EMAIL_CONSENT";
  return phase === "VERIFY_ID" ? "VERIFY_ID" : null;
}

function buildSystem(
  phase: Phase,
  transitions: { from: Phase; to: Phase }[],
  directives: string[],
  tone: string | null,
  data: Record<string, unknown>,
): string {
  const moved = transitions.length
    ? `\nThis turn the SOP moved: ${[transitions[0].from, ...transitions.map((t) => t.to)].join(" → ")}.`
    : "";
  return [
    PERSONA,
    RULES,
    `CURRENT STEP: ${phase} (${STEP_SUMMARY[phase]}).${moved}`,
    `INSTRUCTIONS FOR THIS TURN:\n${directives.map((d) => `- ${d}`).join("\n")}`,
    tone ? `TONE:\n${tone}` : "",
    `PHASE_DATA (the only facts you may use):\n${JSON.stringify(data, null, 2)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Deterministic summary used if the summary model call fails. */
function fallbackSummary(session: Session): EmailSummary {
  const mem = session.memory;
  return {
    subject: mem.selected_case_id ? `Summary of your call about claim ${mem.selected_case_id}` : "Summary of your call",
    discussed: mem.discussed.map((d) => d.topic),
    claim_status_outcome: mem.selected_case_id ? "See the claim details discussed on the call." : "No specific claim was discussed.",
    next_steps: mem.follow_ups.length ? mem.follow_ups : ["No follow-up needed."],
  };
}

function recordProcessing(session: Session, ctx: ProcessContext) {
  const mem = session.memory;
  const labels: Record<ProcessContext["path"], string> = {
    explain_denial: "Why the claim was denied and what's needed",
    status_update: "Claim status",
    document_guidance: "How to prepare and submit the required documents",
    followup_qa: "Follow-up questions about the claim",
  };
  const topic = `${labels[ctx.path]} (${ctx.claim.case_id})`;
  if (!mem.discussed.some((d) => d.topic === topic)) mem.discussed.push({ topic, turn: session.turn });

  const docs = ctx.claim.documents_needed ?? [];
  if (docs.length) {
    const deadline = deadlineInfo(ctx.claim);
    const due = deadline && !deadline.passed ? ` before the appeal deadline (${deadline.date})` : "";
    const item = `Submit ${joinDocuments(docs)} for claim ${ctx.claim.case_id}${due}.`;
    if (!mem.follow_ups.includes(item)) mem.follow_ups.push(item);
  }
}

async function sendSummaryEmail(session: Session, llm: Llm): Promise<"sent" | "failed"> {
  const mem = session.memory;
  const holder = findPolicyholder(mem.verified_party_id!)!;
  const claim = mem.selected_case_id ? getClaimDetail(session, mem.selected_case_id) : null;
  const context = JSON.stringify(
    {
      claim: claim && {
        case_id: claim.case_id,
        case_type: claim.case_type,
        status: claim.status,
        summary: claim.summary,
        denial_reason: claim.denial_reason,
        documents_needed: claim.documents_needed,
        appeal_deadline: claim.appeal_deadline,
      },
      discussed: mem.discussed.map((d) => d.topic),
      follow_ups: mem.follow_ups,
      transcript: session.transcript.slice(-12).map((t) => `${t.role}: ${t.text}`),
    },
    null,
    2,
  );
  let summary: EmailSummary;
  try {
    summary = await llm.summarize({ context });
  } catch {
    summary = fallbackSummary(session);
    addTrace(session, "error", "summary model call failed; used the deterministic summary");
  }
  const email = renderEmail(summary, { firstName: holder.name.split(" ")[0], caseId: mem.selected_case_id ?? null });
  const result = await sendEmailSummary(session, email);
  return result.status;
}

export async function runTurn(session: Session, text: string, llm: Llm): Promise<TurnResult> {
  if (session.busy) throw new SessionBusy("A turn is already running for this session");
  session.busy = true;
  const snap = snapshot(session);

  try {
    if (TERMINAL.has(session.phase)) {
      return { reply: session.phase === "TRANSFERRED" ? TRANSFERRED_MESSAGE : ENDED_MESSAGE };
    }

    session.turn += 1;
    const mem = session.memory;
    const startPhase = session.phase;
    const lastAgent = [...session.transcript].reverse().find((t) => t.role === "assistant")?.text ?? null;

    // ① UNDERSTAND, with a deterministic backstop for structured PII the model missed.
    const proposed = await llm.understand({ phase: startPhase, lastAgentMessage: lastAgent, callerMessage: text });
    const backfill = backfillIdentity(text, proposed.identity);
    const u = { ...proposed, identity: { ...proposed.identity, ...backfill } };
    addTrace(session, "understand", `scope=${u.scope} emotion=${u.emotion}${u.intent ? ` intent=${u.intent}` : ""}`, u);
    if (Object.keys(backfill).length) {
      addTrace(session, "understand", `code backfilled identity the model missed: ${Object.keys(backfill).join(", ")}`);
    }
    session.transcript.push({ role: "user", text, turn: session.turn });

    // Identity switch after verification: back to VERIFY_ID (SPEC §4.1, sticky otherwise).
    if (u.identity_switch && mem.verified_party_id) {
      resetIdentity(mem);
      transition(session, "VERIFY_ID", "caller switched identity");
    }

    // ② REMEMBER. In PROCESS_CASE, hints that don't fit the open claim mean "another claim".
    let switchingCase = false;
    if (session.phase === "PROCESS_CASE" && mem.selected_case_id) {
      const hints = newCaseHints(u);
      const current = getClaimDetail(session, mem.selected_case_id);
      switchingCase = hasAnyHint(hints) && (hints.case_id ? hints.case_id.replace(/\D/g, "") !== current.case_id.replace(/\D/g, "") : !fitsHints(current, hints));
    }
    const changes = mergeUnderstanding(mem, u, session.turn, switchingCase ? "replace" : "refine");
    if (changes.length) addTrace(session, "memory", `remembered ${changes.map((c) => c.field).join(", ")}`, changes);
    if (switchingCase) {
      mem.selected_case_id = undefined;
      transition(session, "RESOLVE_INTENT", "caller asked about a different claim");
    }

    // ③ + ④ GATES, with global policies first.
    let scope: ScopeOutcome = "in_scope";
    let missing: Missing | null = null;
    const emailState: { result?: "sent" | "failed"; decision?: "send" | "skip" } = {};
    const hintTurn = mem.case_hints_source_turn;

    if (u.wants_human) {
      transferToHuman(session, "caller asked for a human");
      transition(session, "TRANSFERRED", "caller asked for a human");
    } else if ((scope = applyScope(session, u)) === "transfer") {
      transferToHuman(session, "repeated out-of-scope requests");
      transition(session, "TRANSFERRED", "repeated out-of-scope requests");
    } else if (scope === "in_scope") {
      // Inner loop: cascade through gates memory already satisfies (SPEC §3.1).
      for (let i = 0; i < 5 && !TERMINAL.has(session.phase); i++) {
        const phase = session.phase as keyof typeof GATE_FOR;
        const result = GATE_FOR[phase](session, { u, startedHere: phase === startPhase });
        addTrace(session, "gate", `${phase}: ${result.status}`, result);

        if (result.status === "escape") {
          if (result.to === "TRANSFERRED") transferToHuman(session, result.reason);
          else endConversation(session, result.reason);
          transition(session, result.to, result.reason);
          break;
        }
        if (result.status === "stay") {
          missing = result.missing;
          break;
        }
        if (phase === "POST_PROCESS") {
          emailState.decision = mem.email.decision;
          if (mem.email.decision === "send") emailState.result = await sendSummaryEmail(session, llm);
          endConversation(session, `email ${mem.email.decision}`);
          transition(session, "ENDED", result.note);
          break;
        }
        transition(session, NEXT[phase]!, result.note);
      }
    }
    // Off-topic turns skip the gates: the phase doesn't move (SPEC §6.1).

    // ⑤ RESPOND, with only this phase's visible data.
    const phase = session.phase;
    const transitions = session.phaseHistory.filter((t) => t.turn === session.turn);
    let processCtx: ProcessContext | null = null;
    if (phase === "PROCESS_CASE" && scope === "in_scope") {
      processCtx = chooseProcessPath(session, u, text);
      recordProcessing(session, processCtx);
      addTrace(session, "policy", `workflow path: ${processCtx.path}`);
    }
    // The case was resolved from something the caller already said (this
    // turn or before verification), not from a question we asked.
    const caseFromEarlierHint = transitions.some((t) => t.to === "PROCESS_CASE") && hintTurn !== undefined;

    const directives = buildDirectives({
      phase,
      missing,
      scope,
      u,
      transitions,
      processPath: processCtx?.path ?? null,
      caseFromEarlierHint,
      email: emailState,
      endReason: session.endReason,
      verifyAsks: mem.verify_asks,
    });
    const gate = blockingGate(phase, missing);
    const tone = emotionDirective(
      u.emotion,
      gate,
      gate === "VERIFY_ID" ? ["any other identity details from the list", "a transfer to a human representative"] : [],
    );
    const data = visibleData(session, missing, processCtx);
    const system = buildSystem(phase, transitions, directives, tone, data);
    const transcript = session.transcript.map((t) => ({ role: t.role, content: t.text }));

    let reply = await llm.respond({ system, transcript });

    // ⑥ FILTER
    if (!mem.verified_party_id) {
      const leak = leakCheck(reply, session.transcript.filter((t) => t.role === "user").map((t) => t.text));
      if (leak.leaked) {
        addTrace(session, "leak_blocked", `blocked pre-verification reply (${leak.hits.join(", ")})`, { blocked: reply });
        reply = SAFE_VERIFY_FALLBACK;
      }
    } else if (processCtx) {
      let check = groundingCheck(reply, processCtx.allowed);
      if (check.ungrounded.length) {
        addTrace(session, "grounding_flag", `ungrounded: ${check.ungrounded.join(", ")}; regenerating once`);
        const strict = `${system}\n\nYOUR PREVIOUS DRAFT mentioned ${check.ungrounded.join(", ")}, which is not in PHASE_DATA. Rewrite without any amount or date that isn't in PHASE_DATA.`;
        reply = await llm.respond({ system: strict, transcript });
        check = groundingCheck(reply, processCtx.allowed);
        if (check.ungrounded.length) addTrace(session, "grounding_flag", `still ungrounded after retry: ${check.ungrounded.join(", ")}`);
      }
    }

    if (phase === "VERIFY_ID" && missing?.kind === "identity") mem.verify_asks += 1;
    session.transcript.push({ role: "assistant", text: reply, turn: session.turn });
    addTrace(session, "respond", `replied in ${phase}`, { directives });
    return { reply };
  } catch (err) {
    // API failure mid-turn: put the SOP state back exactly as it was (SPEC §9).
    restore(session, snap);
    addTrace(session, "error", err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    session.busy = false;
  }
}
