/**
 * Identity normalization and matching (SPEC §4.1). Pure functions over the
 * policyholder fixtures. This is the only code that compares caller-supplied
 * PII to records, and its output carries field *names*, never record values,
 * so nothing here can leak a stored value to the LLM.
 */
import { policyholders, type IdType, type Policyholder } from "@/apps/insurance_claims/data";
import { GATES } from "@/apps/insurance_claims/sop.config";

export const IDENTITY_FIELDS = ["name", "dob", "phone", "email", "id_last4", "policy_number"] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];
export type IdentityFields = Partial<Record<IdentityField, string>>;

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

export function normalizeName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z\s'-]/g, " ").replace(/\s+/g, " ").trim();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function expandYear(y: number): number {
  if (y >= 100) return y;
  // Two-digit years: anything that would be in the future is last century.
  const thisYear = new Date().getFullYear() % 100;
  return y > thisYear ? 1900 + y : 2000 + y;
}

function isoIfValid(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Normalizes common spoken/typed DOB formats to ISO YYYY-MM-DD, or null. */
export function normalizeDob(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/,/g, " ");

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return isoIfValid(+m[1], +m[2], +m[3]);

  // US order: M/D/YYYY or M/D/YY
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) return isoIfValid(expandYear(+m[3]), +m[1], +m[2]);

  const monthIndex = (word: string) => MONTHS.findIndex((mo) => mo.startsWith(word.slice(0, 3)));

  // "March 15 1985"
  m = s.match(/^([a-z]+)\.?\s+(\d{1,2})\s+(\d{2,4})$/);
  if (m && monthIndex(m[1]) >= 0) return isoIfValid(expandYear(+m[3]), monthIndex(m[1]) + 1, +m[2]);

  // "15 March 1985"
  m = s.match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{2,4})$/);
  if (m && monthIndex(m[2]) >= 0) return isoIfValid(expandYear(+m[3]), monthIndex(m[2]) + 1, +m[1]);

  return null;
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.slice(-10);
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeLast4(raw: string): string {
  return raw.replace(/\D/g, "").slice(-4);
}

export function normalizePolicy(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Does one supplied field match this record? */
export function fieldMatches(field: IdentityField, value: string, rec: Policyholder): boolean {
  switch (field) {
    case "name": {
      const v = normalizeName(value);
      return [rec.name, ...(rec.name_aliases ?? [])].some((n) => normalizeName(n) === v);
    }
    case "dob":
      return normalizeDob(value) === rec.dob;
    case "phone": {
      const v = normalizePhone(value);
      return v.length === 10 && [rec.phone, ...(rec.phone_aliases ?? [])].some((p) => normalizePhone(p) === v);
    }
    case "email": {
      const v = normalizeEmail(value);
      return [rec.email, ...(rec.email_aliases ?? [])].some((e) => normalizeEmail(e) === v);
    }
    case "id_last4": {
      const v = normalizeLast4(value);
      return v.length === 4 && v === rec.id_last4;
    }
    case "policy_number": {
      const v = normalizePolicy(value);
      const stored = normalizePolicy(rec.policy_number);
      // "9921" alone still identifies POL-9921.
      return v === stored || (v.length >= 4 && /^\d+$/.test(v) && stored.endsWith(v));
    }
  }
}

export type IdentityMatch = {
  /** Best-matching record, or null if nothing supplied matches any record. */
  candidatePartyId: string | null;
  supplied: IdentityField[];
  matched: IdentityField[];
  /** Supplied fields that contradict the candidate (or everything, if no candidate). */
  mismatched: IdentityField[];
  verified: boolean;
  /** Lets the agent say "SSN" vs "national ID" once a record is known. */
  candidateIdType: IdType | null;
};

/**
 * Finds the record the caller most plausibly is and scores the supplied
 * fields against it. Fields work as an OR: any `minIdentityFields` matches on
 * the same record pass, as long as nothing supplied contradicts it. The
 * policy number is both the preferred lookup key and one of the factors.
 */
export function matchIdentity(
  fields: IdentityFields,
  records: readonly Policyholder[] = policyholders,
): IdentityMatch {
  const supplied = IDENTITY_FIELDS.filter((f) => fields[f]?.trim());

  let best: { rec: Policyholder; matched: IdentityField[] } | null = null;
  for (const rec of records) {
    const matched = supplied.filter((f) => fieldMatches(f, fields[f]!, rec));
    if (matched.length === 0) continue;
    const better =
      !best ||
      matched.length > best.matched.length ||
      (matched.length === best.matched.length && matched.includes("policy_number"));
    if (better) best = { rec, matched };
  }

  if (!best) {
    return {
      candidatePartyId: null,
      supplied,
      matched: [],
      mismatched: supplied,
      verified: false,
      candidateIdType: null,
    };
  }

  const mismatched = supplied.filter((f) => !best.matched.includes(f));
  return {
    candidatePartyId: best.rec.party_id,
    supplied,
    matched: best.matched,
    mismatched,
    verified: best.matched.length >= GATES.minIdentityFields && mismatched.length === 0,
    candidateIdType: best.rec.id_type,
  };
}
