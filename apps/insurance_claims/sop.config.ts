/**
 * Insurance-specific SOP parameters. The engine in lib/sop reads these
 * instead of hardcoding them, so thresholds live in one place (SPEC §3.1,
 * §4, §6).
 */

export const PHASES = ["VERIFY_ID", "RESOLVE_INTENT", "PROCESS_CASE", "POST_PROCESS"] as const;

export const GATES = {
  /** Distinct matching identity fields needed on one record (SPEC §4.1). */
  minIdentityFields: 3,
  /** Failed verify attempts: offer a human at 2, transfer at 3. */
  verifyFailOfferHuman: 2,
  verifyFailTransfer: 3,
  /** Consecutive off-topic turns: offer a human at 2, transfer at 3 (SPEC §6.1). */
  offTopicOfferHuman: 2,
  offTopicTransfer: 3,
  /** Refusals in the consent gates (rep consent, email): offer at 2, transfer at 3. */
  persuasionOfferHuman: 2,
  persuasionTransfer: 3,
  /** RESOLVE_INTENT turns with no progress before a human is offered. */
  resolveNoProgressOfferHuman: 3,
  /** Unclear answers to the email offer before treating it as "skip". */
  emailAmbiguousLimit: 2,
} as const;

export const INTENTS = [
  "denial_question",
  "status_inquiry",
  "document_submission",
  "next_steps",
  "general_claim_question",
] as const;
export type Intent = (typeof INTENTS)[number];

export const WORKFLOW_PATHS = [
  "explain_denial",
  "status_update",
  "document_guidance",
  "followup_qa",
] as const;
export type WorkflowPath = (typeof WORKFLOW_PATHS)[number];

/** Default path per intent. `followup_qa` overrides it when a guideline topic matches. */
export const INTENT_TO_PATH: Record<Intent, WorkflowPath> = {
  denial_question: "explain_denial",
  status_inquiry: "status_update",
  document_submission: "document_guidance",
  next_steps: "explain_denial",
  general_claim_question: "status_update",
};

export const IDENTITY_FIELD_LABELS = {
  name: "full name",
  dob: "date of birth",
  phone: "phone number",
  email: "email address",
  id_last4: "last 4 of your SSN or national ID",
  policy_number: "policy number",
} as const;

/**
 * Fixed explanations for why each gate exists. Injected into the reply
 * prompt when the caller pushes back, so the "why" is consistent instead of
 * improvised (SPEC §6.2).
 */
export const GATE_RATIONALES = {
  VERIFY_ID:
    "Claim details are protected health and financial information. Verifying identity first protects the caller from someone else calling about their claim.",
  REP_CONSENT:
    "A policyholder's claim details can only be shared with someone else after the policyholder approves it.",
  EMAIL_CONSENT:
    "A summary is only emailed if the caller explicitly asks for it, and only to the email address on file.",
} as const;

/**
 * `missing_required_material_alternatives` has no `match_any` in the
 * fixture, so these phrases stand in for it.
 */
export const ALTERNATIVES_MATCH = [
  "don't have",
  "dont have",
  "do not have",
  "can't get",
  "cant get",
  "cannot get",
  "not available",
  "lost",
  "alternative",
  "instead",
  "substitute",
];
