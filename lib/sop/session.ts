import { randomUUID } from "crypto";
import type { ConsentScenarioName } from "@/apps/insurance_claims/data";
import type { TraceEvent } from "@/lib/trace";
import { createMemory, type SessionMemory } from "./memory";
import type { Phase } from "./state-machine";

export type TranscriptEntry = { role: "user" | "assistant"; text: string; turn: number };

export type OutboxEmail = {
  id: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  status: "sent" | "failed";
  provider: string;
  turn: number;
};

/**
 * Everything the SOP depends on. Lives only on the server (SPEC §2.1); the
 * browser holds the id and gets a read-only view.
 */
export type Session = {
  id: string;
  createdAt: number;
  lastActive: number;
  turn: number;
  phase: Phase;
  phaseHistory: { from: Phase; to: Phase; reason: string; turn: number }[];
  memory: SessionMemory;
  transcript: TranscriptEntry[];
  trace: TraceEvent[];
  outbox: OutboxEmail[];
  consentScenario: ConsentScenarioName;
  endReason?: string;
  /** Attached by the chat route for the duration of one turn. Not state. */
  traceSink?: (e: TraceEvent) => void;
  /** Serializes turns so two requests can't interleave on one session. */
  busy: boolean;
};

export function createSession(consentScenario: ConsentScenarioName = "default"): Session {
  const now = Date.now();
  return {
    id: randomUUID(),
    createdAt: now,
    lastActive: now,
    turn: 0,
    phase: "VERIFY_ID",
    phaseHistory: [],
    memory: createMemory(),
    transcript: [],
    trace: [],
    outbox: [],
    consentScenario,
    busy: false,
  };
}
