"use client";

import { useEffect, useRef } from "react";
import type { SessionView } from "./api";

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
  disabled,
}: {
  messages: ChatMessage[];
  outbox: SessionView["outbox"];
  pending: boolean;
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages.length, pending, outbox.length]);

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
      <form
        className="flex gap-2 border-t border-neutral-800 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <input
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
          placeholder={disabled ? "Conversation ended. Start a new session." : "Type a message…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled}
        />
        <button
          type="submit"
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          disabled={disabled || pending || !input.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}
