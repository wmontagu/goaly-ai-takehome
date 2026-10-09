/**
 * Server-side session state (SPEC §2.1): a Map in this one Render process,
 * stashed on globalThis so Next.js dev hot-reload doesn't wipe it. Idle
 * sessions are evicted after 30 minutes. Nothing else touches the Map.
 */
import type { ConsentScenarioName } from "@/apps/insurance_claims/data";
import { createSession, type Session } from "@/lib/sop/session";

const IDLE_TTL_MS = 30 * 60 * 1000;
const SWEEP_EVERY_MS = 5 * 60 * 1000;

type Store = { sessions: Map<string, Session>; lastSweep: number };

const g = globalThis as unknown as { __sopStore?: Store };
const store: Store = g.__sopStore ?? { sessions: new Map(), lastSweep: Date.now() };
g.__sopStore = store;

function sweep(now: number) {
  if (now - store.lastSweep < SWEEP_EVERY_MS) return;
  store.lastSweep = now;
  for (const [id, s] of store.sessions) {
    if (now - s.lastActive > IDLE_TTL_MS) store.sessions.delete(id);
  }
}

export function newSession(consentScenario?: ConsentScenarioName): Session {
  sweep(Date.now());
  const s = createSession(consentScenario);
  store.sessions.set(s.id, s);
  return s;
}

export function getSession(id: string): Session | undefined {
  const now = Date.now();
  sweep(now);
  const s = store.sessions.get(id);
  if (s) s.lastActive = now;
  return s;
}

export function deleteSession(id: string): void {
  store.sessions.delete(id);
}
