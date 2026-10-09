/**
 * The SOP's explicit state (SPEC §3, §3.1). Only code calls transition();
 * the LLM has no way to change the phase. Illegal edges throw, and phases
 * past VERIFY_ID can't be entered without a verified party.
 */
import { addTrace } from "@/lib/trace";
import type { Session } from "./session";

export type Phase =
  | "VERIFY_ID"
  | "RESOLVE_INTENT"
  | "PROCESS_CASE"
  | "POST_PROCESS"
  | "TRANSFERRED"
  | "ENDED";

export const TERMINAL: ReadonlySet<Phase> = new Set(["TRANSFERRED", "ENDED"]);

const EDGES: Record<Phase, Phase[]> = {
  VERIFY_ID: ["RESOLVE_INTENT", "TRANSFERRED", "ENDED"],
  // VERIFY_ID is reachable from later phases only through an identity switch.
  RESOLVE_INTENT: ["PROCESS_CASE", "VERIFY_ID", "TRANSFERRED", "ENDED"],
  PROCESS_CASE: ["POST_PROCESS", "RESOLVE_INTENT", "VERIFY_ID", "TRANSFERRED", "ENDED"],
  POST_PROCESS: ["ENDED", "VERIFY_ID", "TRANSFERRED"],
  TRANSFERRED: [],
  ENDED: [],
};

/** The single forward edge each working phase has. */
export const NEXT: Partial<Record<Phase, Phase>> = {
  VERIFY_ID: "RESOLVE_INTENT",
  RESOLVE_INTENT: "PROCESS_CASE",
  PROCESS_CASE: "POST_PROCESS",
  POST_PROCESS: "ENDED",
};

export class IllegalTransition extends Error {}

export function canTransition(from: Phase, to: Phase): boolean {
  return EDGES[from].includes(to);
}

export function transition(session: Session, to: Phase, reason: string): void {
  const from = session.phase;
  if (!canTransition(from, to)) {
    throw new IllegalTransition(`Illegal transition ${from} → ${to}`);
  }
  const needsVerified = to === "RESOLVE_INTENT" || to === "PROCESS_CASE" || to === "POST_PROCESS";
  if (needsVerified && !session.memory.verified_party_id) {
    throw new IllegalTransition(`${to} requires a verified caller`);
  }
  if (to === "PROCESS_CASE" && !session.memory.selected_case_id) {
    throw new IllegalTransition("PROCESS_CASE requires a selected case");
  }
  session.phase = to;
  session.phaseHistory.push({ from, to, reason, turn: session.turn });
  addTrace(session, "transition", `${from} → ${to}`, { reason });
}
