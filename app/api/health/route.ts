import { MODEL_RESPOND, MODEL_UNDERSTAND } from "@/lib/llm/client";

export const dynamic = "force-dynamic";

/**
 * Render health check, plus enough config to debug a deploy from a browser.
 * It reports only whether the server key is set and well-formed, never the key.
 */
export function GET() {
  const raw = process.env.ANTHROPIC_API_KEY ?? "";
  const key = raw.trim();
  let serverKey = "missing";
  if (key) {
    if (/^["']|["']$/.test(key)) serverKey = "set, but wrapped in quotes (remove them)";
    else if (key.startsWith("ANTHROPIC_API_KEY")) serverKey = "set, but includes the variable name (paste only the key)";
    else if (!key.startsWith("sk-ant-")) serverKey = "set, but doesn't look like an Anthropic key (should start with sk-ant-)";
    else serverKey = raw === key ? "set" : "set (with stray whitespace, which is trimmed)";
  }
  return Response.json({
    ok: true,
    serverKey,
    models: { understand: MODEL_UNDERSTAND(), respond: MODEL_RESPOND() },
    speechToText: process.env.DEEPGRAM_API_KEY?.trim() ? "deepgram" : "browser fallback (no DEEPGRAM_API_KEY)",
    sopToday: process.env.SOP_TODAY || null,
  });
}
