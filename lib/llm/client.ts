import Anthropic from "@anthropic-ai/sdk";

export const MODEL_UNDERSTAND = () => process.env.MODEL_UNDERSTAND || "claude-haiku-5-5";
export const MODEL_RESPOND = () => process.env.MODEL_RESPOND || "claude-sonnet-5-5";

/** Server-side fallback when Sonnet's safety classifiers decline a request. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class MissingApiKey extends Error {}

/**
 * A UI-supplied key (sent per request, never stored or logged) takes
 * precedence over the server's ANTHROPIC_API_KEY. With neither, fail fast
 * with a typed error so the UI can show a clear "add a key" banner.
 */
export function getClient(apiKeyOverride?: string | null): Anthropic {
  const override = apiKeyOverride?.trim();
  const key = override || process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new MissingApiKey("No Anthropic API key configured");
  // A key that isn't scoped to a workspace must name one per request. This
  // belongs to the server's key only, never to a key pasted in the UI.
  const workspace = override ? undefined : process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic({ apiKey: key, defaultHeaders: workspace ? { "anthropic-workspace-id": workspace } : undefined });
}
