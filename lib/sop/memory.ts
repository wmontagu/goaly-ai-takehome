/**
 * SessionMemory (SPEC §5). Written on every turn in every phase; only the
 * gate of the right phase may act on what's stored. Each merge returns a
 * change list so the trace shows exactly what was remembered and when.
 */
import type { ConsentStatus } from "@/apps/insurance_claims/data";
import type { Intent } from "@/apps/insurance_claims/sop.config";
import type { CaseHints } from "@/lib/domain/case-match";
import { IDENTITY_FIELDS, type IdentityFields } from "@/lib/domain/identity";
import type { Emotion, Understanding } from "./understanding";

export type SessionMemory = {
  identity: IdentityFields;
  caller_role: "policyholder" | "representative";
  rep_name?: string;
  rep_relationship?: string;
  verified_party_id?: string;
  intent?: Intent;
  intent_source_turn?: number;
  case_hints: CaseHints;
  case_hints_source_turn?: number;
  selected_case_id?: string;
  discussed: { topic: string; turn: number }[];
  follow_ups: string[];
  emotion_history: Emotion[];
  strikes: { off_topic: number; verify_fail: number; persuasion: number };
  /** How many times the agent has asked for identity. The first ask is free (SPEC §4.1). */
  verify_asks: number;
  resolve_no_progress: number;
  email: { offered: boolean; decision?: "send" | "skip"; ambiguous: number };
  consent: { status?: ConsentStatus; polls: number };
};

export function createMemory(): SessionMemory {
  return {
    identity: {},
    caller_role: "policyholder",
    case_hints: {},
    discussed: [],
    follow_ups: [],
    emotion_history: [],
    strikes: { off_topic: 0, verify_fail: 0, persuasion: 0 },
    verify_asks: 0,
    resolve_no_progress: 0,
    email: { offered: false, ambiguous: 0 },
    consent: { polls: 0 },
  };
}

export type MemoryChange = { field: string; from: unknown; to: unknown };

function hintsFrom(u: Understanding): CaseHints {
  const h = u.case_hints;
  const out: CaseHints = {};
  if (h.case_id) out.case_id = h.case_id;
  if (h.case_type) out.case_type = h.case_type;
  if (h.status) out.status = h.status;
  if (h.month && h.month >= 1 && h.month <= 12) out.month = h.month;
  if (h.year) out.year = h.year;
  return out;
}

export function newCaseHints(u: Understanding): CaseHints {
  return hintsFrom(u);
}

/**
 * Merges this turn's proposal into memory, regardless of phase.
 * `hintMode`: "refine" adds to existing case hints (collecting or
 * disambiguating); "replace" swaps them out (the caller moved to another claim).
 */
export function mergeUnderstanding(
  mem: SessionMemory,
  u: Understanding,
  turn: number,
  hintMode: "refine" | "replace" = "refine",
): MemoryChange[] {
  const changes: MemoryChange[] = [];
  const set = (field: string, from: unknown, to: unknown, apply: () => void) => {
    if (JSON.stringify(from) === JSON.stringify(to)) return;
    apply();
    changes.push({ field, from, to });
  };

  for (const f of IDENTITY_FIELDS) {
    const v = u.identity[f]?.trim();
    if (v) set(`identity.${f}`, mem.identity[f], v, () => (mem.identity[f] = v));
  }

  if (u.caller_role) set("caller_role", mem.caller_role, u.caller_role, () => (mem.caller_role = u.caller_role!));
  if (u.rep_name) set("rep_name", mem.rep_name, u.rep_name, () => (mem.rep_name = u.rep_name!));
  if (u.rep_relationship)
    set("rep_relationship", mem.rep_relationship, u.rep_relationship, () => (mem.rep_relationship = u.rep_relationship!));

  if (u.intent) {
    set("intent", mem.intent, u.intent, () => {
      mem.intent = u.intent!;
      mem.intent_source_turn = turn;
    });
  }

  const hints = hintsFrom(u);
  if (Object.keys(hints).length > 0) {
    const next = hintMode === "replace" ? hints : { ...mem.case_hints, ...hints };
    set("case_hints", mem.case_hints, next, () => {
      mem.case_hints = next;
      mem.case_hints_source_turn = turn;
    });
  }

  mem.emotion_history.push(u.emotion);
  return changes;
}

/** Caller switched who they are (SPEC §4.1, "sticky unless identity switch"). */
export function resetIdentity(mem: SessionMemory): void {
  mem.identity = {};
  mem.verified_party_id = undefined;
  mem.selected_case_id = undefined;
  mem.caller_role = "policyholder";
  mem.rep_name = undefined;
  mem.rep_relationship = undefined;
  mem.consent = { polls: 0 };
  mem.verify_asks = 0;
  mem.strikes.verify_fail = 0;
}
