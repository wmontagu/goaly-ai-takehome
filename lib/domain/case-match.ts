/**
 * Resolves which claim the caller means from remembered hints (SPEC §4.2).
 * Hints are hard filters, not soft scores: "denied healthcare January" keeps
 * only claims that are denied AND healthcare AND from January. An explicit
 * case ID overrides everything. Only the verified party's claims are ever
 * considered, so another party's case can't be selected.
 */
import { claimsForParty, type CaseType, type Claim, type ClaimStatus } from "@/apps/insurance_claims/data";

export type CaseHints = {
  case_id?: string;
  case_type?: CaseType;
  status?: ClaimStatus;
  /** 1-12 */
  month?: number;
  year?: number;
};

export type CaseResolution =
  | { kind: "selected"; caseId: string; via: "case_id" | "hints" }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "none"; candidates: string[] };

export function hasAnyHint(h: CaseHints): boolean {
  return Boolean(h.case_id || h.case_type || h.status || h.month || h.year);
}

function normalizeCaseId(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits ? `CL-${digits}` : raw.trim().toUpperCase();
}

function fitsHints(c: Claim, h: CaseHints): boolean {
  const [y, m] = c.created_at.split("-").map(Number);
  if (h.case_type && c.case_type !== h.case_type) return false;
  if (h.status && c.status !== h.status) return false;
  if (h.month && m !== h.month) return false;
  if (h.year && y !== h.year) return false;
  return true;
}

export function resolveCase(partyId: string, hints: CaseHints): CaseResolution {
  const partyClaims = claimsForParty(partyId);

  if (hints.case_id) {
    const wanted = normalizeCaseId(hints.case_id);
    const hit = partyClaims.find((c) => c.case_id === wanted);
    if (hit) return { kind: "selected", caseId: hit.case_id, via: "case_id" };
    // An ID that isn't theirs falls through to the other hints, never to another party.
  }

  if (!hasAnyHint({ ...hints, case_id: undefined })) {
    return { kind: "none", candidates: partyClaims.map((c) => c.case_id) };
  }

  const fits = partyClaims.filter((c) => fitsHints(c, hints));
  if (fits.length === 1) return { kind: "selected", caseId: fits[0].case_id, via: "hints" };
  if (fits.length > 1) return { kind: "ambiguous", candidates: fits.map((c) => c.case_id) };
  return { kind: "none", candidates: partyClaims.map((c) => c.case_id) };
}
