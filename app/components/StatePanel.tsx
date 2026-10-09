"use client";

import type { SessionView } from "./api";

const STEPS = ["VERIFY_ID", "RESOLVE_INTENT", "PROCESS_CASE", "POST_PROCESS"] as const;

function Stepper({ view }: { view: SessionView }) {
  const terminal = view.phase === "TRANSFERRED" || view.phase === "ENDED";
  const reachedIdx = Math.max(
    0,
    ...view.phaseHistory.flatMap((t) => [t.from, t.to]).map((p) => STEPS.indexOf(p as (typeof STEPS)[number])),
  );
  // Steps before this index are complete. ENDED means all four are.
  const doneBefore = view.phase === "ENDED" ? STEPS.length : terminal ? reachedIdx : STEPS.indexOf(view.phase as (typeof STEPS)[number]);
  return (
    <div className="space-y-1.5">
      {STEPS.map((p, i) => {
        const current = view.phase === p;
        const done = i < doneBefore;
        return (
          <div
            key={p}
            className={`flex items-center gap-2 rounded px-2 py-1 text-xs font-mono ${
              current ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/50" : done ? "text-emerald-300" : "text-neutral-500"
            }`}
          >
            <span className="w-4 text-center">{done ? "✓" : current ? "●" : "○"}</span>
            {p}
          </div>
        );
      })}
      {terminal && (
        <div
          className={`rounded px-2 py-1 text-xs font-mono ${
            view.phase === "TRANSFERRED" ? "bg-amber-500/20 text-amber-200" : "bg-neutral-700/40 text-neutral-300"
          }`}
        >
          {view.phase} {view.endReason ? `· ${view.endReason}` : ""}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{title}</h3>
      {children}
    </section>
  );
}

function Row({ k, v, turn }: { k: string; v: React.ReactNode; turn?: number | null }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-neutral-400">{k}</span>
      <span className="text-right font-mono text-neutral-200">
        {v}
        {turn ? <span className="ml-1 text-neutral-500">(turn {turn})</span> : null}
      </span>
    </div>
  );
}

function Strike({ label, n, offer, max }: { label: string; n: number; offer: number; max: number }) {
  const color = n >= max ? "text-red-400" : n >= offer ? "text-amber-300" : "text-neutral-200";
  return <Row k={label} v={<span className={color}>{`${n} / ${max}`}</span>} />;
}

export function StatePanel({ view }: { view: SessionView | null }) {
  if (!view) return <div className="p-4 text-sm text-neutral-500">Starting session…</div>;
  const m = view.memory;
  const hints = Object.entries(m.case_hints)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const matchedCount = view.identity.filter((f) => f.matched).length;

  return (
    <div className="space-y-5 p-4">
      <Section title="SOP phase (server-owned)">
        <Stepper view={view} />
      </Section>

      <Section title={`Identity · ${view.verified ? "verified" : `${matchedCount} of 3 matched`}`}>
        <div className="space-y-1">
          {view.identity.map((f) => (
            <div key={f.field} className="flex items-center justify-between text-xs">
              <span className={f.provided ? "text-neutral-200" : "text-neutral-500"}>
                <span className="mr-1.5 inline-block w-3">{f.provided ? (f.matched ? "✓" : "✗") : "·"}</span>
                {f.label}
              </span>
              <span className="font-mono text-neutral-400">{f.masked ?? ""}</span>
            </div>
          ))}
        </div>
        {m.caller_role === "representative" && (
          <Row k="representative" v={`${m.rep_name ?? "?"} · consent ${m.consent.status ?? "not requested"}`} />
        )}
      </Section>

      <Section title="Memory (written every turn, every phase)">
        <Row k="intent" v={m.intent ?? "-"} turn={m.intent_source_turn} />
        <Row k="case hints" v={hints || "-"} turn={m.case_hints_source_turn} />
        <Row k="selected case" v={m.selected_case_id ?? "-"} />
        <Row k="last emotion" v={m.last_emotion ?? "-"} />
        {m.discussed.length > 0 && (
          <div className="text-xs">
            <div className="text-neutral-400">discussed</div>
            <ul className="ml-4 list-disc text-neutral-300">
              {m.discussed.map((d) => (
                <li key={d.topic}>{d.topic}</li>
              ))}
            </ul>
          </div>
        )}
        {m.follow_ups.length > 0 && (
          <div className="text-xs">
            <div className="text-neutral-400">follow-ups</div>
            <ul className="ml-4 list-disc text-neutral-300">
              {m.follow_ups.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Escalation counters">
        <Strike label="failed verify attempts" n={view.strikes.verify_fail} offer={2} max={3} />
        <Strike label="off-topic (consecutive)" n={view.strikes.off_topic} offer={2} max={3} />
        <Strike label="consent refusals" n={view.strikes.persuasion} offer={2} max={3} />
        <Row k="email" v={m.email.decision ?? (m.email.offered ? "offered" : "-")} />
      </Section>
    </div>
  );
}
