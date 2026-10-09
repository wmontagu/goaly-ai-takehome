/**
 * Call ⑤ RESPOND and the email-summary call: Sonnet. The system prompt the
 * engine builds holds the only claim data this call can see.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { EmailSummarySchema, type EmailSummary } from "@/lib/domain/email-summary";
import { FALLBACK_BETA, MODEL_RESPOND } from "./client";
import type { RespondInput, SummarizeInput } from "./types";

export class ModelRefusal extends Error {}

export async function respond(client: Anthropic, input: RespondInput): Promise<string> {
  const message = await client.beta.messages.create({
    model: MODEL_RESPOND(),
    max_tokens: 8000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: input.system,
    messages: input.transcript,
  });
  if (message.stop_reason === "refusal") throw new ModelRefusal("reply declined by the model");
  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new ModelRefusal("empty reply");
  return text;
}

const SUMMARY_SYSTEM = `You write the content of a short post-call email summary for an insurance customer. Use only facts in the provided context. Each list item is one plain sentence. Never include a date of birth, SSN, national ID, or phone number.
- subject: short, includes the claim ID if there is one.
- discussed: 2-4 items, what the call covered.
- claim_status_outcome: one or two sentences on the claim's status and outcome.
- next_steps: the concrete follow-up items for the customer, with deadlines if given.`;

export async function summarize(client: Anthropic, input: SummarizeInput): Promise<EmailSummary> {
  const response = await client.beta.messages.parse({
    model: MODEL_RESPOND(),
    max_tokens: 4000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(EmailSummarySchema) },
    system: SUMMARY_SYSTEM,
    messages: [{ role: "user", content: input.context }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new ModelRefusal("summary not produced");
  }
  return response.parsed_output;
}
