/**
 * The read-only view of a session the UI renders (SPEC §2.1, §10). Built
 * fresh from server state on every request; the browser never sends any of
 * it back. Identity values are masked.
 */
import { IDENTITY_FIELD_LABELS } from "@/apps/insurance_claims/sop.config";
import { IDENTITY_FIELDS, matchIdentity } from "@/lib/domain/identity";
import type { Session } from "./session";

function mask(v: string): string {
  const t = v.trim();
  if (t.length <= 3) return "*".repeat(t.length);
  return `${t[0]}${"*".repeat(Math.min(t.length - 3, 8))}${t.slice(-2)}`;
}

export function sessionView(s: Session) {
  const mem = s.memory;
  const match = matchIdentity(mem.identity);
  return {
    id: s.id,
    turn: s.turn,
    phase: s.phase,
    phaseHistory: s.phaseHistory,
    endReason: s.endReason ?? null,
    consentScenario: s.consentScenario,
    identity: IDENTITY_FIELDS.map((f) => ({
      field: f,
      label: IDENTITY_FIELD_LABELS[f],
      provided: Boolean(mem.identity[f]),
      masked: mem.identity[f] ? mask(mem.identity[f]!) : null,
      matched: match.matched.includes(f),
    })),
    verified: Boolean(mem.verified_party_id),
    memory: {
      caller_role: mem.caller_role,
      rep_name: mem.rep_name ?? null,
      intent: mem.intent ?? null,
      intent_source_turn: mem.intent_source_turn ?? null,
      case_hints: mem.case_hints,
      case_hints_source_turn: mem.case_hints_source_turn ?? null,
      selected_case_id: mem.selected_case_id ?? null,
      discussed: mem.discussed,
      follow_ups: mem.follow_ups,
      last_emotion: mem.emotion_history.at(-1) ?? null,
      consent: mem.consent,
      email: mem.email,
    },
    strikes: mem.strikes,
    verifyAsks: mem.verify_asks,
    outbox: s.outbox,
    transcript: s.transcript,
    trace: s.trace,
  };
}

export type SessionView = ReturnType<typeof sessionView>;
