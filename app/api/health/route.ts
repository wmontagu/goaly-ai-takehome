export const dynamic = "force-dynamic";

/** Render health check. */
export function GET() {
  return Response.json({ ok: true });
}
