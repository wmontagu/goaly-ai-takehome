"use client";

import { useCallback, useEffect, useState } from "react";
import { createSession, sendMessage, SessionGone, type SessionView, type TraceEvent } from "./components/api";
import { Chat, type ChatMessage } from "./components/Chat";
import { SCRIPTS, type Script } from "./components/scripts";
import { StatePanel } from "./components/StatePanel";
import { TracePanel } from "./components/TracePanel";
import { useCallMode } from "./components/useCallMode";

const KEY_STORAGE = "sop-agent-api-key";

function readStoredKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

function storeKey(v: string) {
  try {
    if (v) sessionStorage.setItem(KEY_STORAGE, v);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // storage blocked: the key just lives in memory for this tab
  }
}

/** Desktop column layouts, indexed by how many side panels are open. */
const LAYOUT = [
  "",
  "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]",
  "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1fr)]",
];

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-pressed={on}
      className={`rounded border px-2.5 py-1 text-xs ${
        on ? "border-sky-600 bg-sky-950/40 text-sky-200" : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function Home() {
  const [view, setView] = useState<SessionView | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [consent, setConsent] = useState<"default" | "timeout">("default");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [showState, setShowState] = useState(true);
  const [showTrace, setShowTrace] = useState(true);
  const [script, setScript] = useState<{ s: Script; next: number } | null>(null);

  const ended = view?.phase === "TRANSFERRED" || view?.phase === "ENDED" ? view.phase : null;
  const call = useCallMode({
    onHeard: (heard) => void send(heard),
    canListen: () => !pending && !ended,
    sessionId: view?.id,
  });
  const stopCall = call.stop;

  const start = useCallback(async (consentScenario: string, notice?: string) => {
    stopCall();
    const v = await createSession(consentScenario);
    setView(v);
    setMessages(notice ? [{ role: "system", text: notice }] : []);
    setTrace([]);
    setInput("");
  }, [stopCall]);

  useEffect(() => {
    void (async () => {
      await start("default");
      setApiKey(readStoredKey());
    })();
  }, [start]);

  function restart() {
    setScript(null);
    void start(consent);
  }

  /** Sends the input box, or `spoken` when the caller talked in Call mode. */
  async function send(spoken?: string) {
    const text = (spoken ?? input).trim();
    if (!text || !view || pending) return;
    // A typed message ends any listening or speech in progress.
    if (spoken === undefined) stopCall();
    setInput("");
    setPending(true);
    setBanner(null);
    setMessages((m) => [...m, { role: "user", text }]);
    const nextLine = script && script.next + 1 < script.s.lines.length ? script.s.lines[script.next + 1] : null;
    if (script) setScript({ ...script, next: script.next + 1 });
    let failed = false;
    try {
      await sendMessage(view.id, text, apiKey, {
        onTrace: (e) => setTrace((t) => [...t, e]),
        onReply: (reply) => {
          setMessages((m) => [...m, { role: "assistant", text: reply }]);
          call.speak(reply);
        },
        onState: (s) => {
          setView(s);
          setTrace(s.trace);
        },
        onError: (e) => {
          failed = true;
          setBanner(e.message);
          // The server rolled the turn back, so drop the optimistic message.
          setMessages((m) => (m.at(-1)?.role === "user" ? m.slice(0, -1) : m));
          setInput(text);
        },
      });
    } catch (err) {
      if (err instanceof SessionGone) {
        await start(consent, "The demo server restarted, so this conversation was reset. Please start again.");
      } else {
        setBanner("Couldn't reach the server. Please try again.");
      }
    } finally {
      setPending(false);
      // Pre-fill the script's next line (never auto-sends).
      if (!failed && nextLine) setInput(nextLine);
    }
  }

  async function runScript(s: Script) {
    const c = s.consent ?? "default";
    setConsent(c);
    await start(c);
    setScript({ s, next: 0 });
    setInput(s.lines[0]);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-2.5">
        <h1 className="text-sm font-semibold">SOP Claims Agent</h1>
        <span className="text-xs text-neutral-500">VERIFY_ID → RESOLVE_INTENT → PROCESS_CASE → POST_PROCESS</span>
        <div className="ml-auto flex gap-2">
          {call.supported.speak && (
            <Toggle on={call.enabled} onClick={call.toggle}>
              📞 Call mode
            </Toggle>
          )}
          <Toggle on={drawerOpen} onClick={() => setDrawerOpen((o) => !o)}>
            Test drawer
          </Toggle>
          <Toggle on={showState} onClick={() => setShowState((o) => !o)}>
            SOP state
          </Toggle>
          <Toggle on={showTrace} onClick={() => setShowTrace((o) => !o)}>
            Trace
          </Toggle>
          <button
            className="rounded bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-900 hover:bg-white"
            onClick={restart}
          >
            New session
          </button>
        </div>
      </header>

      {drawerOpen && (
        <div className="space-y-2 border-b border-neutral-800 bg-neutral-950 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-2">
              <span className="text-neutral-400">Anthropic API key (optional)</span>
              <input
                type="password"
                className="w-64 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono"
                placeholder="uses the server key if empty"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  storeKey(e.target.value);
                }}
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-neutral-400">Rep consent scenario</span>
              <select
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
                value={consent}
                onChange={(e) => {
                  const c = e.target.value as "default" | "timeout";
                  setConsent(c);
                  setScript(null);
                  void start(c);
                }}
              >
                <option value="default">default (pending → approved)</option>
                <option value="timeout">timeout (pending ×5)</option>
              </select>
            </label>
            <span className="text-neutral-500">Key stays in this tab only and is sent per request; never stored on the server.</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-neutral-400">Scripts:</span>
            {SCRIPTS.map((s) => (
              <button
                key={s.id}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${
                  script?.s.id === s.id ? "border-sky-500 text-sky-200" : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                }`}
                onClick={() => void runScript(s)}
              >
                {s.label}
              </button>
            ))}
            {script && (
              <span className="ml-2 text-xs text-neutral-500">
                line {Math.min(script.next + 1, script.s.lines.length)} of {script.s.lines.length} (press Send to use it)
              </span>
            )}
          </div>
        </div>
      )}

      {banner && (
        <div className="border-b border-red-900 bg-red-950/60 px-4 py-2 text-sm text-red-200">{banner}</div>
      )}

      <main className={`grid min-h-0 flex-1 grid-cols-1 ${LAYOUT[Number(showState) + Number(showTrace)]}`}>
        <section
          className={`min-h-[60vh] border-neutral-800 lg:min-h-0 ${showState || showTrace ? "lg:border-r" : "mx-auto w-full max-w-3xl"}`}
        >
          <Chat
            messages={messages}
            outbox={view?.outbox ?? []}
            handoff={view?.handoff ?? null}
            pending={pending}
            input={input}
            setInput={setInput}
            onSend={() => void send()}
            ended={ended}
            onRestart={restart}
            call={
              call.enabled
                ? {
                    status: call.status,
                    error: call.error,
                    canListen: call.supported.listen,
                    onMic: () => (call.status === "listening" ? call.finish() : call.listen()),
                  }
                : null
            }
          />
        </section>
        {showState && (
          <section
            className={`overflow-y-auto border-t border-neutral-800 lg:border-t-0 ${showTrace ? "lg:border-r" : ""}`}
          >
            <StatePanel view={view} />
          </section>
        )}
        {showTrace && (
          <section className="max-h-[70vh] overflow-y-auto border-t border-neutral-800 lg:max-h-none lg:border-t-0">
            <div className="sticky top-0 border-b border-neutral-800 bg-neutral-950 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Trace
            </div>
            <TracePanel events={trace} />
          </section>
        )}
      </main>
    </div>
  );
}
