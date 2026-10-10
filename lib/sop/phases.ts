/**
 * Context isolation (SPEC §7, layer 1): the ONLY data call ⑤ gets to see is
 * what visibleData() builds for the current phase. Pre-verification that is
 * field names and counts, never a record value. Claim data is fetched
 * through the tool allowlist, so a wrong phase can't load it here either.
 */
import { claimFieldGlossary, findPolicyholder, guideline, type Claim } from "@/apps/insurance_claims/data";
import { INTENT_TO_PATH, type WorkflowPath } from "@/apps/insurance_claims/sop.config";
import { maskEmail } from "@/lib/domain/email-summary";
import { applicableFollowups, deadlineInfo, matchFollowups, today } from "@/lib/domain/guidance";
import type { Retrieved } from "@/lib/domain/retrieval";
import { getClaimDetail, getDocumentGuidance } from "@/lib/tools";
import type { Missing } from "./gates";
import type { Session } from "./session";
import type { Understanding } from "./understanding";

export { TOOL_ALLOWLIST as toolAllowlist } from "@/lib/tools";

export type ProcessContext = {
  claim: Claim;
  path: WorkflowPath;
  data: Record<string, unknown>;
  /** Amounts and dates the reply may mention (grounding check input). */
  allowed: { amounts: string[]; dates: string[] };
};

/** Picks the bounded workflow path from the classifier's intent, validated in code (SPEC §4.3). */
export function chooseProcessPath(session: Session, u: Understanding, userText: string): ProcessContext {
  const mem = session.memory;
  const claim = getClaimDetail(session, mem.selected_case_id!);
  const intent = u.intent ?? mem.intent ?? "general_claim_question";
  // Match fixture phrases against the caller's own words and the paraphrase.
  const question = [userText, u.question].filter(Boolean).join(" | ");

  const followups = matchFollowups(question, intent, claim);
  let path: WorkflowPath = followups.matches.length ? "followup_qa" : INTENT_TO_PATH[intent];
  // Denial explanation only makes sense for a denied claim.
  if (path === "explain_denial" && claim.status !== "denied") path = "status_update";

  const guidance = getDocumentGuidance(session, claim);
  const deadline = deadlineInfo(claim);
  const amounts = [claim.expected_reimbursement_amount, claim.allowed_max_amount, claim.net_pay, claim.net_fee];
  const dates = [claim.created_at, today(), ...(claim.appeal_deadline ? [claim.appeal_deadline] : [])];

  const data: Record<string, unknown> = {
    today: today(),
    workflow_path: path,
    claim,
    appeal_deadline: deadline,
    documents: guidance.documents,
    case_type_guidance: guidance.case_type_guidance,
    default_document_guidance: guideline.default_guidance.en,
    matched_followup_answers: followups.matches,
    all_followup_guidance_for_this_claim: applicableFollowups(claim),
    followup_fallback: followups.matches.length ? undefined : followups.fallback,
    human_review_policy: guideline.claim_followup_settings.human_review_after_document_alternatives_exhausted.en,
    amount_field_glossary: path === "status_update" ? claimFieldGlossary : undefined,
  };
  return { claim, path, data, allowed: { amounts, dates } };
}

/** The verified caller's own account basics, so "what's my policy number?" has a real answer. */
function verifiedAccount(session: Session) {
  const holder = session.memory.verified_party_id ? findPolicyholder(session.memory.verified_party_id) : undefined;
  return holder ? { policyholder_name: holder.name, policy_number: holder.policy_number } : null;
}

export function visibleData(
  session: Session,
  missing: Missing | null,
  process: ProcessContext | null,
  /** BM25 matches for this turn's question, from the verified caller's own records and shared guidance. */
  retrieved: Retrieved[] = [],
): Record<string, unknown> {
  const records = retrieved.length ? retrieved.map((r) => ({ source: r.id, text: r.text })) : undefined;
  const mem = session.memory;
  switch (session.phase) {
    case "VERIFY_ID":
      return {
        caller_role: mem.caller_role,
        accepted_identity_fields: "any 3 of: full name, date of birth, phone number, email address, SSN or national ID last 4, policy number",
        gate: missing,
      };
    case "RESOLVE_INTENT":
      return {
        account: verifiedAccount(session),
        records_matching_question: records,
        remembered_from_earlier: { intent: mem.intent ?? null, case_hints: mem.case_hints },
        gate: missing,
      };
    case "PROCESS_CASE":
      return { account: verifiedAccount(session), ...(process?.data ?? {}), records_matching_question: records };
    case "POST_PROCESS": {
      const holder = findPolicyholder(mem.verified_party_id!);
      return {
        account: verifiedAccount(session),
        records_matching_question: records,
        email_on_file_masked: holder ? maskEmail(holder.email) : null,
        email_offer: missing,
        discussed: mem.discussed.map((d) => d.topic),
        follow_ups: mem.follow_ups,
      };
    }
    default:
      return { reason: session.endReason ?? null };
  }
}
