/**
 * The note a human agent gets on transfer: who's calling, whether they're
 * verified, what they want, how they're feeling, and what was already tried,
 * so the caller doesn't have to start over.
 *
 * Built by code from SessionMemory, not by the model, so it costs nothing and
 * can't invent facts. Claim data from the fixtures appears only once the
 * caller is verified; before that, the note carries only what the caller said.
 */
import { findClaim, findPolicyholder } from "@/apps/insurance_claims/data";
import { GATES } from "@/apps/insurance_claims/sop.config";
import { matchIdentity } from "@/lib/domain/identity";
import type { Session } from "./session";

export type HandoffNote = {
  turn: number;
  reason: string;
  /** Label/value rows, in the order a human agent reads them. */
  rows: { label: string; value: string }[];
  /** The one thing the human agent should do first. */
  first_step: string;
};

const INTENT_LABEL: Record<string, string> = {
  denial_question: "why a claim was denied",
  status_inquiry: "the status of a claim",
  document_submission: "submitting documents",
  next_steps: "what to do next on a claim",
  general_claim_question: "a general claim question",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function hintText(h: Session["memory"]["case_hints"]): string | null {
  const parts = [
    h.case_id,
    h.status,
    h.case_type,
    "claim",
    h.month ? `from ${MONTHS[h.month - 1]}${h.year ? ` ${h.year}` : ""}` : h.year ? `from ${h.year}` : undefined,
  ].filter(Boolean);
  return parts.length > 1 ? `"${parts.join(" ")}" (caller's words, not checked)` : null;
}

function mood(history: Session["memory"]["emotion_history"]): string {
  const last = history.at(-1) ?? "neutral";
  const upset = history.filter((e) => e !== "neutral").length;
  if (last === "neutral" && upset === 0) return "Calm throughout.";
  const trend = upset > 1 ? ` Upset on ${upset} of ${history.length} turns.` : "";
  return `${last[0].toUpperCase()}${last.slice(1)} at transfer.${trend}`;
}

export function buildHandoff(session: Session, reason: string): HandoffNote {
  const mem = session.memory;
  const rows: HandoffNote["rows"] = [];
  const holder = mem.verified_party_id ? findPolicyholder(mem.verified_party_id) : undefined;

  if (holder) {
    rows.push({ label: "Identity", value: `Verified: ${holder.name}, policy ${holder.policy_number}.` });
  } else {
    const matched = matchIdentity(mem.identity).matched.length;
    rows.push({
      label: "Identity",
      value: `Not verified (${matched} of ${GATES.minIdentityFields} required details matched). Don't discuss any claim until verified.`,
    });
  }

  if (mem.caller_role === "representative") {
    const consent = mem.consent.status === "approved" ? "consent approved" : `consent ${mem.consent.status ?? "not requested"}`;
    rows.push({
      label: "Caller",
      value: `${mem.rep_name ?? "A representative"}${mem.rep_relationship ? ` (${mem.rep_relationship})` : ""}, calling on the policyholder's behalf; ${consent}.`,
    });
  }

  const need = mem.intent ? `Asking about ${INTENT_LABEL[mem.intent] ?? mem.intent}.` : "Hadn't said what they need yet.";
  rows.push({ label: "Needs", value: need });

  const claim = holder && mem.selected_case_id ? findClaim(holder.party_id, mem.selected_case_id) : undefined;
  if (claim) {
    const deadline = claim.appeal_deadline ? `, appeal deadline ${claim.appeal_deadline}` : "";
    rows.push({ label: "Claim", value: `${claim.case_id}: ${claim.case_type}, ${claim.status}${deadline}.` });
  } else {
    const hint = hintText(mem.case_hints);
    if (hint) rows.push({ label: "Claim", value: hint });
  }

  rows.push({ label: "Mood", value: mood(mem.emotion_history) });

  const tried: string[] = [];
  if (mem.strikes.verify_fail) tried.push(`${mem.strikes.verify_fail} failed verification attempt(s)`);
  if (mem.strikes.off_topic) tried.push(`${mem.strikes.off_topic} off-topic request(s) in a row`);
  if (mem.strikes.persuasion) tried.push(`declined a required step ${mem.strikes.persuasion} time(s)`);
  if (mem.consent.polls) tried.push(`checked policyholder consent ${mem.consent.polls} time(s)`);
  if (mem.discussed.length) tried.push(`covered: ${mem.discussed.map((d) => d.topic).join("; ")}`);
  rows.push({ label: "Already tried", value: tried.length ? `${tried.join(", ")}.` : "Nothing yet." });

  if (mem.follow_ups.length) rows.push({ label: "Open follow-ups", value: mem.follow_ups.join("; ") });

  const lastWords = [...session.transcript].reverse().find((t) => t.role === "user")?.text;
  if (lastWords) rows.push({ label: "Last said", value: `"${lastWords}"` });

  const first_step = !holder
    ? "Verify identity first."
    : mem.caller_role === "representative" && mem.consent.status !== "approved"
      ? "Caller is verified, but the policyholder hasn't approved this representative yet. Get consent before sharing claim details."
      : "Caller is already verified. Don't ask for ID again; pick up from the need above.";

  return { turn: session.turn, reason, rows, first_step };
}
