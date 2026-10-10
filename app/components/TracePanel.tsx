"use client";

import { useEffect, useRef } from "react";
import type { TraceEvent } from "./api";

const KIND_COLOR: Record<TraceEvent["kind"], string> = {
  understand: "text-violet-300",
  memory: "text-sky-300",
  gate: "text-neutral-300",
  transition: "text-emerald-300",
  policy: "text-amber-300",
  tool: "text-teal-300",
  tool_rejected: "text-red-400",
  leak_blocked: "text-red-400",
  grounding_flag: "text-orange-300",
  retrieval: "text-cyan-300",
  respond: "text-neutral-500",
  error: "text-red-400",
};

export function TracePanel({ events }: { events: TraceEvent[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  if (!events.length) {
    return <div className="p-4 text-sm text-neutral-500">Each turn&apos;s pipeline steps appear here as they run.</div>;
  }
  return (
    <div className="space-y-1 p-3 font-mono text-[11px]">
      {events.map((e, i) => {
        const header = i === 0 || events[i - 1].turn !== e.turn;
        return (
          <div key={e.id}>
            {header && <div className="mt-3 mb-1 border-t border-neutral-800 pt-2 text-neutral-500">turn {e.turn}</div>}
            <details className="group">
              <summary className="cursor-pointer list-none">
                <span className={`${KIND_COLOR[e.kind]} mr-2`}>{e.kind}</span>
                <span className="text-neutral-300">{e.summary}</span>
              </summary>
              {e.data !== undefined && (
                <pre className="mt-1 max-h-72 overflow-auto rounded bg-neutral-900 p-2 text-[10px] text-neutral-400">
                  {JSON.stringify(e.data, null, 2)}
                </pre>
              )}
            </details>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
