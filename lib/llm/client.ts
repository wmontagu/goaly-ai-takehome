import Anthropic from "@anthropic-ai/sdk";

export const MODEL_UNDERSTAND = () => process.env.MODEL_UNDERSTAND || "claude-haiku-5-5";
export const MODEL_RESPOND = () => process.env.MODEL_RESPOND || "claude-sonnet-5-5";

/** Server-side fallback when Sonnet's safety classifiers decline a request. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * A UI-supplied key (sent per request, never stored or logged) takes
 * precedence over the server's ANTHROPIC_API_KEY. With neither, the SDK
 * falls back to its own credential resolution.
 */
export function getClient(apiKeyOverride?: string | null): Anthropic {
  const key = apiKeyOverride?.trim();
  return key ? new Anthropic({ apiKey: key }) : new Anthropic();
}
