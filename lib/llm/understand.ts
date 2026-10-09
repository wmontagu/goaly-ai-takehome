/**
 * Call ① UNDERSTAND: Haiku, structured output, low effort. Sees only the
 * caller's message, the phase name, and the agent's previous message (which
 * the output filter keeps clean before verification). Never sees fixtures.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { UNDERSTAND_SYSTEM } from "@/apps/insurance_claims/prompts/understand";
import { SAFE_UNDERSTANDING, UnderstandingSchema, type Understanding } from "@/lib/sop/understanding";
import { MODEL_UNDERSTAND } from "./client";
import type { UnderstandInput } from "./types";

export async function understand(client: Anthropic, input: UnderstandInput): Promise<{ result: Understanding; fallback: boolean }> {
  const content = [
    `Current step: ${input.phase}`,
    `Agent's previous message: ${input.lastAgentMessage ? JSON.stringify(input.lastAgentMessage) : "(none, this is the first message)"}`,
    `Caller's message: ${JSON.stringify(input.callerMessage)}`,
  ].join("\n");

  // Retry once on a schema failure, then fall back to the safe default (SPEC §9).
  // API errors are not caught here: the engine rolls the turn back instead.
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.parse({
      model: MODEL_UNDERSTAND(),
      max_tokens: 2048,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: zodOutputFormat(UnderstandingSchema) },
      system: UNDERSTAND_SYSTEM,
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason !== "refusal" && response.parsed_output) {
      return { result: response.parsed_output, fallback: false };
    }
  }
  return { result: SAFE_UNDERSTANDING, fallback: true };
}
