/**
 * Deterministic backstop for identity extraction. Structured PII (emails,
 * policy numbers, phone numbers, labeled dates of birth and last-4s) has
 * an unambiguous shape, so code pulls it straight from the caller's words
 * and fills any field the understand model left blank. Found by the
 * golden evals: Haiku occasionally dropped "DOB 1985-03-15" from a
 * multi-field message.
 *
 * Only fills blanks; never overrides what the model extracted.
 */
import type { IdentityField, IdentityFields } from "./identity";
import { normalizeDob } from "./identity";

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE = `(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{2,4}|\\d{1,2}\\s+${MONTH},?\\s+\\d{2,4})`;

const PATTERNS: Record<IdentityField, RegExp | null> = {
  email: /\b([\w.+-]+@[\w-]+(?:\.[\w-]+)+)\b/i,
  policy_number: /\b(POL[-\s]?\d{3,})\b/i,
  phone: /(?<!\d)((?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})(?!\d)/,
  dob: new RegExp(`\\b(?:dob|d\\.o\\.b\\.?|date of birth|born(?: on)?|birthday)\\b[^0-9a-z]{0,6}(?:is\\s+|was\\s+|on\\s+)?${DATE}`, "i"),
  // "claim id"/"case id" and "CL-2048" are claim numbers, not identity.
  id_last4: /(?<!(?:claim|case)\s)\b(?:ssn|social(?: security)?(?: number)?|national id|id)\b[^0-9]{0,30}?(?<![-\d])(\d{4})\b/i,
  // Names have no reliable shape; that stays with the model.
  name: null,
};

/** Fields found in `text` by pattern, for any field `extracted` left blank. */
export function backfillIdentity(text: string, extracted: IdentityFields): IdentityFields {
  const filled: IdentityFields = {};
  for (const [field, re] of Object.entries(PATTERNS) as [IdentityField, RegExp | null][]) {
    if (!re || extracted[field]?.trim()) continue;
    const m = text.match(re);
    if (!m) continue;
    const value = m[1].trim();
    if (field === "dob" && !normalizeDob(value)) continue;
    filled[field] = value;
  }
  return filled;
}
