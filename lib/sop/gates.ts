/**
 * Phase gates (SPEC §3.1, §4). Each gate checks its phase's exit condition
 * against memory and the fixtures, never against the LLM's opinion, and
 * returns one of:
 *   pass    → the engine advances to the next phase
 *   stay    → the phase repeats next turn; `missing` says what to ask for
 *   escape  → a bounded exit (human transfer or end), so no loop runs forever
 */
import { GATES, IDENTITY_FIELD_LABELS } from "@/apps/insurance_claims/sop.config";
import { resolveCase, type CaseResolution } from "@/lib/domain/case-match";
import { IDENTITY_FIELDS, matchIdentity, type IdentityField } from "@/lib/domain/identity";
import { consentTimedOut, isListedRepresentative } from "@/lib/domain/representative";
import { getClaims, requestPolicyholderConsent, type ClaimIndexEntry } from "@/lib/tools";
import { addTrace } from "@/lib/trace";
import type { Session } from "./session";
import type { Understanding } from "./understanding";

export type VerifyFailure = "mismatch" | "still_short" | "refusal";

export type Missing =
  | {
      kind: "identity";
      provided: IdentityField[];
      still_needed: number;
      failure_this_turn: VerifyFailure | null;
      /** Something provided (this turn or earlier) contradicts the record. Never says which. */
      has_mismatch: boolean;
      failed_attempts: number;
      offer_human: boolean;
      /** "SSN last 4" or "national ID last 4" once a record is plausible. */
      id_label: string;
      not_yet_provided: string[];
    }
  | { kind: "rep_details"; offer_human: boolean }
  | { kind: "consent_pending"; offer_human: boolean }
  | {
      kind: "case";
      resolution: CaseResolution["kind"];
      candidates: ClaimIndexEntry[];
      need_case: boolean;
      need_intent: boolean;
      offer_human: boolean;
    }
  | { kind: "open_qa" }
  | { kind: "email_decision"; asked_before: boolean };

export type GateResult =
  | { status: "pass"; note: string }
  | { status: "stay"; missing: Missing }
  | { status: "escape"; to: "TRANSFERRED" | "ENDED"; reason: string };

type Ctx = { u: Understanding; startedHere: boolean };

function verifyGate(session: Session, { u, startedHere }: Ctx): GateResult {
  const mem = session.memory;
  const match = matchIdentity(mem.identity);
  const newThisTurn = IDENTITY_FIELDS.filter((f) => u.identity[f]?.trim());

  if (match.verified && match.candidatePartyId) {
    const partyId = match.candidatePartyId;
    if (mem.caller_role !== "representative") {
      mem.verified_party_id = partyId;
      return { status: "pass", note: `verified ${partyId} on ${match.matched.join(", ")}` };
    }

    // Third-party caller: policyholder PII matched, now the rep and consent (SPEC §6.3).
    if (!isListedRepresentative(partyId, mem.rep_name, mem.rep_relationship)) {
      if (startedHere && mem.rep_name && newThisTurn.length === 0) mem.strikes.verify_fail += 1;
      if (mem.strikes.verify_fail >= GATES.verifyFailTransfer) {
        return { status: "escape", to: "TRANSFERRED", reason: "representative_not_authorized" };
      }
      return { status: "stay", missing: { kind: "rep_details", offer_human: mem.strikes.verify_fail >= GATES.verifyFailOfferHuman } };
    }
    if (mem.consent.status !== "approved") {
      if (startedHere && (u.refuses_identity || u.emotion === "angry")) mem.strikes.persuasion += 1;
      if (mem.strikes.persuasion >= GATES.persuasionTransfer) {
        return { status: "escape", to: "TRANSFERRED", reason: "caller_declined_consent_wait" };
      }
      const status = requestPolicyholderConsent(session);
      if (status === "denied") return { status: "escape", to: "TRANSFERRED", reason: "consent_denied" };
      if (status !== "approved") {
        if (consentTimedOut(session.consentScenario, mem.consent.polls)) {
          return { status: "escape", to: "TRANSFERRED", reason: "consent_timeout" };
        }
        return {
          status: "stay",
          missing: { kind: "consent_pending", offer_human: mem.strikes.persuasion >= GATES.persuasionOfferHuman },
        };
      }
    }
    mem.verified_party_id = partyId;
    return { status: "pass", note: `verified ${partyId} via representative ${mem.rep_name} with consent` };
  }

  // Not verified yet: decide whether this turn was a failed attempt (SPEC §4.1).
  let failure: VerifyFailure | null = null;
  if (startedHere) {
    const exempt = u.asks_about_process || u.wants_human || u.scope !== "in_scope";
    const progressed = newThisTurn.some((f) => match.matched.includes(f));
    const contradicted =
      newThisTurn.some((f) => match.mismatched.includes(f)) &&
      (match.candidatePartyId !== null || match.supplied.length >= GATES.minIdentityFields);

    if (u.refuses_identity) failure = "refusal";
    else if (contradicted) failure = "mismatch";
    else if (mem.verify_asks > 0 && !progressed && !exempt) failure = "still_short";
  }
  if (failure) {
    mem.strikes.verify_fail += 1;
    addTrace(session, "policy", `failed verify attempt (${failure})`, { verify_fail: mem.strikes.verify_fail });
  }
  if (mem.strikes.verify_fail >= GATES.verifyFailTransfer) {
    return { status: "escape", to: "TRANSFERRED", reason: "verification_failed" };
  }

  const hasMismatch = match.mismatched.length > 0;
  return {
    status: "stay",
    missing: {
      kind: "identity",
      provided: match.supplied,
      // Counted from what was *provided*, not matched, so the reply can't
      // reveal which fields were right.
      still_needed: hasMismatch ? GATES.minIdentityFields : Math.max(0, GATES.minIdentityFields - match.supplied.length),
      failure_this_turn: failure,
      has_mismatch: hasMismatch,
      failed_attempts: mem.strikes.verify_fail,
      offer_human: mem.strikes.verify_fail >= GATES.verifyFailOfferHuman,
      id_label:
        match.candidateIdType === "national_id_last4" && !hasMismatch ? "national ID last 4" : "SSN last 4 (or national ID last 4)",
      not_yet_provided: IDENTITY_FIELDS.filter((f) => !match.supplied.includes(f)).map((f) => IDENTITY_FIELD_LABELS[f]),
    },
  };
}

function resolveGate(session: Session, { startedHere }: Ctx): GateResult {
  const mem = session.memory;
  const partyId = mem.verified_party_id!;
  const index = getClaims(session);
  const before = { case: mem.selected_case_id, intent: mem.intent };

  let res = resolveCase(partyId, mem.case_hints);
  if (res.kind === "none" && index.length === 1) {
    res = { kind: "selected", caseId: index[0].case_id, via: "hints" };
  }
  if (res.kind === "selected") mem.selected_case_id = res.caseId;

  if (mem.selected_case_id && mem.intent) {
    const via = res.kind === "selected" ? res.via : "earlier selection";
    return { status: "pass", note: `case ${mem.selected_case_id} (${via}), intent ${mem.intent}` };
  }

  const progressed = before.case !== mem.selected_case_id || before.intent !== mem.intent;
  if (startedHere && !progressed) mem.resolve_no_progress += 1;
  if (progressed) mem.resolve_no_progress = 0;

  const candidateIds = res.kind === "selected" ? [res.caseId] : res.candidates;
  return {
    status: "stay",
    missing: {
      kind: "case",
      resolution: res.kind,
      candidates: index.filter((c) => candidateIds.includes(c.case_id)),
      need_case: !mem.selected_case_id,
      need_intent: !mem.intent,
      offer_human: mem.resolve_no_progress >= GATES.resolveNoProgressOfferHuman,
    },
  };
}

function processGate(_session: Session, { u, startedHere }: Ctx): GateResult {
  // Open-ended grounded Q&A. Only the caller saying they're done moves on,
  // and never in the same turn the case was resolved.
  if (startedHere && u.wrap_up) return { status: "pass", note: "caller is done" };
  return { status: "stay", missing: { kind: "open_qa" } };
}

function postGate(session: Session, { u, startedHere }: Ctx): GateResult {
  const email = session.memory.email;
  if (!startedHere || !email.offered) {
    email.offered = true;
    return { status: "stay", missing: { kind: "email_decision", asked_before: false } };
  }
  if (u.email_decision === "send" || u.email_decision === "skip") {
    email.decision = u.email_decision;
    return { status: "pass", note: `email: ${u.email_decision}` };
  }
  email.ambiguous += 1;
  if (email.ambiguous >= GATES.emailAmbiguousLimit) {
    email.decision = "skip";
    return { status: "pass", note: "email: no clear yes, treated as skip" };
  }
  return { status: "stay", missing: { kind: "email_decision", asked_before: true } };
}

export const GATE_FOR = {
  VERIFY_ID: verifyGate,
  RESOLVE_INTENT: resolveGate,
  PROCESS_CASE: processGate,
  POST_PROCESS: postGate,
} as const;
