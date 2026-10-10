import { NextRequest } from "next/server";
import { getSession } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Speech-to-text for Call mode: the browser records the caller and posts the
 * audio here; the server sends it to Deepgram with the server's key. The
 * transcript then goes through /api/chat like any typed message, so nothing
 * about the SOP changes.
 *
 * Only live chat sessions can use it, so the key can't be used from outside
 * the app. Without DEEPGRAM_API_KEY the client falls back to the browser's
 * own speech recognition.
 */

const MAX_BYTES = 5 * 1024 * 1024; // ~5 minutes of opus; a turn is seconds
const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";

/** Lets the client pick server or browser recognition. */
export function GET() {
  return Response.json({ available: Boolean(process.env.DEEPGRAM_API_KEY?.trim()) });
}

export async function POST(req: NextRequest) {
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  if (!key) return Response.json({ error: "Speech-to-text isn't configured on this server." }, { status: 503 });

  if (!getSession(req.headers.get("x-session-id") ?? "")) {
    return Response.json({ error: "session_gone" }, { status: 410 });
  }

  const audio = await req.arrayBuffer();
  if (audio.byteLength === 0) return Response.json({ text: "" });
  if (audio.byteLength > MAX_BYTES) return Response.json({ error: "That recording is too long." }, { status: 413 });

  const params = new URLSearchParams({
    model: process.env.DEEPGRAM_MODEL || "nova-3",
    language: "en",
    smart_format: "true",
  });
  let res: Response;
  try {
    res = await fetch(`${DEEPGRAM_URL}?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${key}`,
        "Content-Type": req.headers.get("content-type") || "audio/webm",
      },
      body: audio,
    });
  } catch (err) {
    console.error("[transcribe] couldn't reach Deepgram:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Couldn't reach the speech-to-text service. Please try again or type." }, { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[transcribe] Deepgram ${res.status}: ${detail.slice(0, 300)}`);
    const error =
      res.status === 401 || res.status === 403
        ? "Deepgram rejected DEEPGRAM_API_KEY. Check it in the host's environment settings."
        : `Speech-to-text failed (${res.status}). Please try again or type.`;
    return Response.json({ error }, { status: 502 });
  }

  const data = (await res.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  };
  const text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
  return Response.json({ text });
}
