"use client";

import type { SessionView } from "@/lib/sop/view";
import type { TraceEvent } from "@/lib/trace";

export type { SessionView } from "@/lib/sop/view";
export type { TraceEvent } from "@/lib/trace";

export class SessionGone extends Error {}

export async function createSession(consentScenario: string): Promise<SessionView> {
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consentScenario }),
  });
  return res.json();
}

type Handlers = {
  onTrace: (e: TraceEvent) => void;
  onReply: (text: string) => void;
  onState: (s: SessionView) => void;
  onError: (e: { code: string; message: string }) => void;
};

/** POSTs one message and consumes the SSE response (trace → reply → state → end). */
export async function sendMessage(sessionId: string, message: string, apiKey: string, h: Handlers): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey.trim()) headers["x-anthropic-api-key"] = apiKey.trim();

  const res = await fetch("/api/chat", { method: "POST", headers, body: JSON.stringify({ sessionId, message }) });
  if (res.status === 410) throw new SessionGone();
  if (!res.ok || !res.body) {
    h.onError({ code: "http", message: `Request failed (${res.status}).` });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = raw.match(/^event: (.*)$/m)?.[1];
      const data = raw.match(/^data: (.*)$/m)?.[1];
      if (!event || data === undefined) continue;
      const parsed = JSON.parse(data);
      if (event === "trace") h.onTrace(parsed);
      else if (event === "reply") h.onReply(parsed.text);
      else if (event === "state") h.onState(parsed);
      else if (event === "error") h.onError(parsed);
    }
  }
}
