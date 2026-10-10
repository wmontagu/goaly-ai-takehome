import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { claudeLlm } from "@/lib/llm";
import { MissingApiKey } from "@/lib/llm/client";
import { getSession } from "@/lib/session-store";
import { runTurn, SessionBusy } from "@/lib/sop/engine";
import { sessionView } from "@/lib/sop/view";
import { addTrace } from "@/lib/trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Optional per-request key from the UI. Never stored or logged. */
const KEY_HEADER = "x-anthropic-api-key";

/** Says which key was used, since a pasted key silently overrides the server's. */
function errorCode(err: unknown, keySource: "test drawer" | "server"): { code: string; message: string } {
  if (err instanceof SessionBusy) return { code: "busy", message: "Still working on your last message." };
  if (err instanceof Anthropic.AuthenticationError) {
    return {
      code: "auth",
      message:
        keySource === "test drawer"
          ? "Anthropic rejected the key pasted in the test drawer. Fix it, or clear the field to use the server's key."
          : "Anthropic rejected the server's ANTHROPIC_API_KEY. Check it in the host's environment settings, or paste a key in the test drawer.",
    };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return { code: "auth", message: `The ${keySource} key can't use this model: ${err.message}` };
  }
  if (err instanceof Anthropic.RateLimitError) return { code: "rate_limit", message: "Rate limited by the model API. Please try again shortly." };
  if (err instanceof Anthropic.APIError) {
    return { code: "api", message: `The model API returned an error${err.status ? ` (${err.status})` : ""}: ${err.message}` };
  }
  if (err instanceof MissingApiKey) {
    return { code: "auth", message: "No Anthropic API key is configured. Add one in the test drawer or set ANTHROPIC_API_KEY." };
  }
  return { code: "internal", message: "Something went wrong. Your conversation state wasn't changed; please try again." };
}

/**
 * Runs one SOP turn and streams it over SSE: a `trace` event per pipeline
 * step as it happens, then `reply`, then the updated read-only `state`.
 * The reply is sent whole, after the output filter has checked it.
 */
export async function POST(req: NextRequest) {
  const { sessionId, message } = (await req.json().catch(() => ({}))) as { sessionId?: string; message?: string };
  const text = message?.trim();
  if (!text) return Response.json({ error: "message is required" }, { status: 400 });

  const session = getSession(sessionId ?? "");
  // Unknown id: the server restarted or the session idled out (SPEC §9).
  if (!session) return Response.json({ error: "session_gone" }, { status: 410 });

  const apiKey = req.headers.get(KEY_HEADER);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      session.traceSink = (e) => send("trace", e);
      try {
        const llm = claudeLlm(apiKey, () => addTrace(session, "error", "understanding failed validation twice; used safe defaults"));
        const { reply } = await runTurn(session, text, llm);
        send("reply", { text: reply });
      } catch (err) {
        const keySource = apiKey?.trim() ? "test drawer" : "server";
        // Logged for the host's log viewer. Anthropic error messages never contain the key.
        console.error(`[chat] turn failed (key from ${keySource}):`, err instanceof Error ? `${err.name}: ${err.message}` : err);
        send("error", errorCode(err, keySource));
      } finally {
        session.traceSink = undefined;
        send("state", sessionView(session));
        send("end", {});
        closed = true;
        try {
          controller.close();
        } catch {
          // client already disconnected
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
