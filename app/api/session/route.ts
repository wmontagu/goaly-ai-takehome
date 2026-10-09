import { NextRequest } from "next/server";
import { consentScenarios, type ConsentScenarioName } from "@/apps/insurance_claims/data";
import { deleteSession, getSession, newSession } from "@/lib/session-store";
import { sessionView } from "@/lib/sop/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start a new session. Body: { consentScenario?: "default" | "timeout" }. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { consentScenario?: string };
  const scenario = (body.consentScenario && body.consentScenario in consentScenarios
    ? body.consentScenario
    : "default") as ConsentScenarioName;
  const s = newSession(scenario);
  return Response.json(sessionView(s));
}

/** Read-only view of a session's server-side state. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const s = getSession(id);
  if (!s) return Response.json({ error: "session_gone" }, { status: 410 });
  return Response.json(sessionView(s));
}

export async function DELETE(req: NextRequest) {
  deleteSession(req.nextUrl.searchParams.get("id") ?? "");
  return Response.json({ ok: true });
}
