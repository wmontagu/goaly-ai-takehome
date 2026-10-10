"use client";

import { useEffect, useRef } from "react";
import type { SessionView } from "./api";
import type { CallStatus } from "./useCallMode";

export type ChatMessage = { role: "user" | "assistant" | "system"; text: string };

function EmailCard({ email }: { email: SessionView["outbox"][number] }) {
  return (
    <div className="mx-auto w-full max-w-md rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-3 text-xs">
      <div className="mb-1 flex justify-between text-emerald-300">
        <span>✉ Email {email.status} ({email.provider})</span>
        <span className="font-mono">{email.to}</span>
      </div>
      <div className="mb-2 font-semibold text-neutral-100">{email.subject}</div>
      <pre className="whitespace-pre-wrap font-sans text-neutral-300">{email.text}</pre>
    </div>
  );
}

export function Chat({
  messages,
  outbox,
  pending,
  input,
  setInput,
  onSend,
  ended,
  onRestart,
  call,
}: {
  messages: ChatMessage[];
  outbox: SessionView["outbox"];
  pending: boolean;
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  /** Set once the SOP reaches a terminal phase: the input is replaced by an end card. */
  ended: "TRANSFERRED" | "ENDED" | null;
  onRestart: () => void;
  /** Present while Call mode is on. */
  call: { status: CallStatus; error: string | null; canListen: boolean; onMic: () => void } | null;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending, outbox.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="mt-8 text-center text-sm text-neutral-500">
            Say hello, describe your claim question, or pick a script from the test drawer.
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "system" ? (
            <div key={i} className="text-center text-xs text-amber-300/80">
              {m.text}
            </div>
          ) : (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                  m.role === "user" ? "bg-sky-600 text-white" : "bg-neutral-800 text-neutral-100"
                }`}
              >
                {m.text}
              </div>
            </div>
          ),
        )}
        {outbox.map((e) => (
          <EmailCard key={e.id || e.subject} email={e} />
        ))}
        {pending && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-neutral-800 px-3.5 py-2 text-sm text-neutral-400">
              <span className="animate-pulse">Agent is typing…</span>
            </div>
          </div>
        )}
        <div ref={end} />
      </div>
      {ended ? (
        <div className="flex flex-col items-center gap-2 border-t border-neutral-800 p-4 text-center">
          <div className="text-sm text-neutral-300">
            {ended === "TRANSFERRED" ? "You've been transferred to a representative." : "Call ended."}
          </div>
          <button
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
            onClick={onRestart}
          >
            Start a new call
          </button>
        </div>
      ) : (
        <>
          {call && (
            <div className="border-t border-neutral-800 px-3 pt-2 text-xs text-neutral-400">
              {call.error ??
                (call.status === "speaking"
                  ? "Agent is speaking… tap the mic to interrupt."
                  : call.status === "listening"
                    ? "Listening… speak now."
                    : call.canListen
                      ? "Tap the mic to talk, or type."
                      : "This browser can't listen, so type your replies. The agent still speaks. (Chrome or Edge can do both.)")}
            </div>
          )}
          <form
            className="flex gap-2 border-t border-neutral-800 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              onSend();
            }}
          >
            <input
              className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
              placeholder="Type a message…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            {call?.canListen && (
              <button
                type="button"
                aria-label={call.status === "listening" ? "Stop listening" : "Talk"}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  call.status === "listening"
                    ? "animate-pulse bg-red-600 text-white"
                    : "border border-neutral-700 text-neutral-200 hover:bg-neutral-800"
                }`}
                onClick={call.onMic}
                disabled={pending}
              >
                {call.status === "listening" ? "● Listening" : "🎤"}
              </button>
            )}
            <button
              type="submit"
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              disabled={pending || !input.trim()}
            >
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}
