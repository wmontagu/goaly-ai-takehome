/**
 * Typed, read-only access to the starter fixtures. The JSON files under
 * ./fixtures are the given data and are never modified; everything else in
 * the app reads them through this module.
 */
import policyholdersJson from "./fixtures/policyholders.json";
import claimsJson from "./fixtures/claims.json";
import representativesJson from "./fixtures/representatives.json";
import consentScenariosJson from "./fixtures/consent_scenarios.json";
import guidelineJson from "./fixtures/required_document_guideline.json";
import claimSchemaJson from "./fixtures/claim_schema.json";

export type IdType = "ssn_last4" | "national_id_last4";

export type Policyholder = {
  party_id: string;
  name: string;
  name_aliases?: string[];
  policy_number: string;
  dob: string;
  id_type: IdType;
  id_last4: string;
  phone: string;
  phone_aliases?: string[];
  email: string;
  email_aliases?: string[];
};

export type CaseType = "healthcare" | "dental" | "auto";
export type ClaimStatus = "denied" | "open" | "closed";

export type Claim = {
  case_id: string;
  party_id: string;
  case_type: CaseType;
  created_at: string;
  status: ClaimStatus;
  summary: string;
  denial_reason?: string;
  documents_needed?: string[];
  appeal_deadline?: string;
  expected_reimbursement_amount: string;
  allowed_max_amount: string;
  net_pay: string;
  net_fee: string;
};

export type Representative = {
  rep_name: string;
  relationship: string;
  buyer_name: string;
  buyer_party_id: string;
};

export type ConsentStatus = "pending" | "approved" | "denied";
export type ConsentScenarioName = keyof typeof consentScenariosJson;

type LocalizedText = { en: string };

export type FollowupTopic = {
  topic: string;
  intent_hints: string[];
  requires_documents: boolean;
  match_any?: string[];
  en: string;
};

export type Guideline = {
  default_guidance: LocalizedText;
  case_type_guidance: Record<string, LocalizedText>;
  document_guidance: Record<string, LocalizedText>;
  document_alternative_guidance: Record<string, LocalizedText>;
  claim_followup_settings: Record<string, LocalizedText>;
  claim_followup_guidance: FollowupTopic[];
  claim_followup_fallback: LocalizedText;
};

export const policyholders: readonly Policyholder[] = policyholdersJson as Policyholder[];
export const claims: readonly Claim[] = claimsJson as Claim[];
export const representatives: readonly Representative[] = representativesJson as Representative[];
export const guideline: Guideline = guidelineJson as Guideline;
export const claimFieldGlossary: Record<string, { description: string }> =
  claimSchemaJson.field_descriptions;

export const consentScenarios: Record<ConsentScenarioName, { status_sequence: ConsentStatus[] }> =
  consentScenariosJson as Record<ConsentScenarioName, { status_sequence: ConsentStatus[] }>;

export function findPolicyholder(partyId: string): Policyholder | undefined {
  return policyholders.find((p) => p.party_id === partyId);
}

/** Claims for one party only. The only way the rest of the app lists claims. */
export function claimsForParty(partyId: string): Claim[] {
  return claims.filter((c) => c.party_id === partyId);
}

export function findClaim(partyId: string, caseId: string): Claim | undefined {
  return claims.find((c) => c.party_id === partyId && c.case_id === caseId);
}
