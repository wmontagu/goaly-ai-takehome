import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Checks a key pasted in the test drawer before the UI starts using it, with
 * a free call (listing models). The key arrives in a header, is used for this
 * one request, and is never stored or logged.
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-anthropic-api-key")?.trim();
  if (!key) return Response.json({ ok: false, message: "Paste a key first." }, { status: 400 });

  try {
    await new Anthropic({ apiKey: key }).models.list({ limit: 1 });
    return Response.json({ ok: true });
  } catch (err) {
    let message = "Couldn't check the key right now. Please try again.";
    if (err instanceof Anthropic.AuthenticationError) message = "Anthropic rejected this key. Check that it was copied in full.";
    else if (err instanceof Anthropic.PermissionDeniedError) message = "This key doesn't have permission to use the API.";
    else if (err instanceof Anthropic.APIError && /workspace/i.test(err.message))
      message = "This key isn't tied to a workspace. Create one inside a workspace in the Anthropic console.";
    return Response.json({ ok: false, message });
  }
}
