/**
 * Global policies that run in every phase (SPEC §6): scope guard, human
 * handoff, and the emotion → response-strategy mapping. Counters live in
 * SessionMemory; thresholds come from sop.config.
 */
import { GATES, GATE_RATIONALES } from "@/apps/insurance_claims/sop.config";
import { addTrace } from "@/lib/trace";
import type { Strikes } from "./memory";
import type { Session } from "./session";
import type { Emotion, Understanding } from "./understanding";

export type ScopeOutcome = "in_scope" | "refuse" | "refuse_offer_human" | "transfer";

/**
 * Consecutive off-topic turns (including injection attempts) strike. The
 * reset happens later, in settleOffTopic, once the gates have run.
 */
export function applyScope(session: Session, u: Understanding): ScopeOutcome {
  const strikes = session.memory.strikes;
  const offTopic = u.scope === "out_of_scope" || u.is_injection;

  if (!offTopic) return "in_scope";

  strikes.off_topic += 1;
  const outcome: ScopeOutcome =
    strikes.off_topic >= GATES.offTopicTransfer
      ? "transfer"
      : strikes.off_topic >= GATES.offTopicOfferHuman
        ? "refuse_offer_human"
        : "refuse";
  addTrace(session, "policy", `${u.is_injection ? "injection attempt" : "out of scope"} → ${outcome}`, {
    off_topic_strikes: strikes.off_topic,
  });
  return outcome;
}

/**
 * An in-scope turn resets the off-topic count, unless the same turn struck
 * another counter (a failed verify attempt, a refusal at a consent gate).
 * That turn is a violation too, so it must not wipe the caller's off-topic
 * history. Smalltalk neither strikes nor resets.
 */
export function settleOffTopic(session: Session, u: Understanding, before: Strikes): void {
  const strikes = session.memory.strikes;
  if (u.scope !== "in_scope" || strikes.off_topic === 0) return;
  if (strikes.verify_fail > before.verify_fail || strikes.persuasion > before.persuasion) {
    addTrace(session, "policy", "off-topic strikes kept (this turn struck another counter)", { off_topic: strikes.off_topic });
    return;
  }
  addTrace(session, "policy", "off-topic strikes reset", { was: strikes.off_topic });
  strikes.off_topic = 0;
}

/** Which gate's rationale applies when the caller pushes back. */
export type BlockingGate = keyof typeof GATE_RATIONALES | null;

/**
 * Turns the classifier's emotion label into a fixed strategy for the reply
 * prompt (SPEC §6.2): acknowledge, explain why, offer alternatives, one
 * concrete next ask. The gate itself never relaxes.
 */
export function emotionDirective(emotion: Emotion, gate: BlockingGate, alternatives: string[]): string | null {
  if (emotion === "neutral") return null;
  const feeling: Record<Exclude<Emotion, "neutral">, string> = {
    frustrated: "frustrated",
    anxious: "worried",
    angry: "upset",
    confused: "confused",
    refusing: "reluctant to continue",
  };
  const parts = [
    `The caller sounds ${feeling[emotion]}. Start with one specific, sincere sentence acknowledging that. Don't grovel or over-apologize.`,
  ];
  if (gate) {
    parts.push(`Then briefly explain why this step is required: ${GATE_RATIONALES[gate]}`);
    parts.push("Do not skip, soften, or bypass the requirement, and do not hint at any claim details.");
  }
  if (alternatives.length) parts.push(`Offer these acceptable alternatives: ${alternatives.join("; ")}.`);
  parts.push("End with exactly one concrete next step for the caller.");
  return parts.join(" ");
}
