/**
 * Per-session trace (ported in spirit from governed-agent-harness's
 * lib/trace.ts). Every pipeline step logs an event; while a turn is running,
 * the chat route attaches a sink so events stream to the UI as they happen.
 */
import { randomUUID } from "crypto";

export type TraceKind =
  | "understand"
  | "memory"
  | "gate"
  | "transition"
  | "policy"
  | "tool"
  | "tool_rejected"
  | "leak_blocked"
  | "grounding_flag"
  | "respond"
  | "error";

export type TraceEvent = {
  id: string;
  turn: number;
  ts: string;
  kind: TraceKind;
  summary: string;
  data?: unknown;
};

export type TraceTarget = {
  turn: number;
  trace: TraceEvent[];
  traceSink?: (e: TraceEvent) => void;
};

export function addTrace(target: TraceTarget, kind: TraceKind, summary: string, data?: unknown): TraceEvent {
  const event: TraceEvent = {
    id: randomUUID(),
    turn: target.turn,
    ts: new Date().toISOString(),
    kind,
    summary,
    data,
  };
  target.trace.push(event);
  target.traceSink?.(event);
  return event;
}
