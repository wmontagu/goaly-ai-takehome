/**
 * Grounded guidance for PROCESS_CASE (SPEC §4.3): document instructions,
 * follow-up topic matching, template filling, and deadline math. Everything
 * the reply says about documents, timing, or deadlines comes from here.
 */
import { guideline, type Claim } from "@/apps/insurance_claims/data";
import { canonicalDocName } from "@/apps/insurance_claims/doc-aliases";
import { ALTERNATIVES_MATCH, type Intent } from "@/apps/insurance_claims/sop.config";

export type DocumentGuidance = {
  /** As written on the claim. */
  name: string;
  /** Guideline key it resolved to. */
  canonical: string;
  how_to_prepare: string | null;
  if_unavailable: string;
};

export function documentGuidance(claim: Claim): DocumentGuidance[] {
  return (claim.documents_needed ?? []).map((name) => {
    const canonical = canonicalDocName(name);
    return {
      name,
      canonical,
      how_to_prepare: guideline.document_guidance[canonical]?.en ?? null,
      if_unavailable:
        guideline.document_alternative_guidance[canonical]?.en ??
        guideline.document_alternative_guidance.default.en,
    };
  });
}

export function caseTypeGuidance(claim: Claim): string | null {
  return guideline.case_type_guidance[claim.case_type]?.en ?? null;
}

export function joinDocuments(docs: string[]): string {
  const withArticle = docs.map((d) => `the ${d}`);
  if (withArticle.length <= 1) return withArticle.join("");
  return `${withArticle.slice(0, -1).join(", ")} and ${withArticle[withArticle.length - 1]}`;
}

export function fillTemplate(text: string, claim: Claim): string {
  return text
    .replaceAll("{case_id}", claim.case_id)
    .replaceAll("{documents}", joinDocuments(claim.documents_needed ?? []))
    .replaceAll(
      "{average_processing_time_after_submission}",
      guideline.claim_followup_settings.average_processing_time_after_submission.en,
    );
}

export type FollowupAnswer = { topic: string; text: string };

/**
 * Matches the caller's question to guideline follow-up topics by the
 * fixture's own `intent_hints` + `match_any` phrases. Returns templated
 * answers, or the fixture's fallback when nothing matches.
 */
export function matchFollowups(
  question: string,
  intent: Intent | undefined,
  claim: Claim,
): { matches: FollowupAnswer[]; fallback: string } {
  const q = question.toLowerCase();
  const hasDocs = (claim.documents_needed ?? []).length > 0;

  const matches = guideline.claim_followup_guidance
    .filter((t) => !t.requires_documents || hasDocs)
    .filter((t) => !intent || t.intent_hints.includes(intent))
    .filter((t) => {
      const phrases = t.match_any ?? (t.topic === "missing_required_material_alternatives" ? ALTERNATIVES_MATCH : []);
      return phrases.some((p) => q.includes(p));
    })
    .map((t) => ({ topic: t.topic, text: fillTemplate(t.en, claim) }));

  return { matches, fallback: guideline.claim_followup_fallback.en };
}

/**
 * Every follow-up topic that applies to this claim, templated. Given to the
 * reply on every PROCESS_CASE turn so the grounded facts stay the same
 * across turns, instead of only the topic matched this turn.
 */
export function applicableFollowups(claim: Claim): FollowupAnswer[] {
  const hasDocs = (claim.documents_needed ?? []).length > 0;
  return guideline.claim_followup_guidance
    .filter((t) => !t.requires_documents || hasDocs)
    .map((t) => ({ topic: t.topic, text: fillTemplate(t.en, claim) }));
}

/** "Today" for deadline math: SOP_TODAY if set (demo/eval determinism), else the real date. */
export function today(): string {
  const fixed = process.env.SOP_TODAY?.trim();
  if (fixed && /^\d{4}-\d{2}-\d{2}$/.test(fixed)) return fixed;
  return new Date().toISOString().slice(0, 10);
}

export type DeadlineInfo = { date: string; days_remaining: number; passed: boolean };

export function deadlineInfo(claim: Claim, asOf: string = today()): DeadlineInfo | null {
  if (!claim.appeal_deadline) return null;
  const ms = Date.parse(claim.appeal_deadline) - Date.parse(asOf);
  const days = Math.round(ms / 86_400_000);
  return { date: claim.appeal_deadline, days_remaining: days, passed: days < 0 };
}
