import { getClient } from "./client";
import { respond, summarize } from "./respond";
import type { Llm } from "./types";
import { understand } from "./understand";

export type { Llm } from "./types";

/** The real model-backed Llm. `onUnderstandFallback` lets the engine trace a schema fallback. */
export function claudeLlm(apiKeyOverride?: string | null, onUnderstandFallback?: () => void): Llm {
  const client = getClient(apiKeyOverride);
  return {
    async understand(input) {
      const { result, fallback } = await understand(client, input);
      if (fallback) onUnderstandFallback?.();
      return result;
    },
    respond: (input) => respond(client, input),
    summarize: (input) => summarize(client, input),
  };
}
