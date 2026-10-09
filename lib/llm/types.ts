import type { EmailSummary } from "@/lib/domain/email-summary";
import type { Understanding } from "@/lib/sop/understanding";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type UnderstandInput = { phase: string; lastAgentMessage: string | null; callerMessage: string };

export type RespondInput = { system: string; transcript: ChatTurn[] };

export type SummarizeInput = { context: string };

/**
 * What the engine needs from a model. The real implementation calls Claude;
 * tests inject a scripted one, which is how the engine's gate logic is
 * tested without an API key.
 */
export interface Llm {
  understand(input: UnderstandInput): Promise<Understanding>;
  respond(input: RespondInput): Promise<string>;
  summarize(input: SummarizeInput): Promise<EmailSummary>;
}
