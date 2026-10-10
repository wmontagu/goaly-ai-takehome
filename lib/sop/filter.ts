/**
 * Output filter (SPEC §7, layer 3). The last line of defense: context
 * isolation should already keep claim data out of pre-verification replies,
 * and this catches anything that slips through anyway.
 *
 *  - leakCheck: before verification, block any reply containing claim or
 *    policyholder data the caller didn't type themselves.
 *  - groundingCheck: after verification, flag dollar amounts and dates that
 *    aren't in the data the reply was given.
 *  - idCheck: after verification, flag policy numbers and claim IDs that
 *    aren't the verified caller's own (the model inventing "POL-55821").
 */
import { claims, claimsForParty, findPolicyholder, policyholders, representatives } from "@/apps/insurance_claims/data";

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function amountVariants(a: string): string[] {
  const n = Number(a);
  if (!Number.isFinite(n) || n === 0) return [];
  const whole = Math.round(n);
  return [a, whole.toLocaleString("en-US"), String(whole)];
}

function dateVariants(iso: string): string[] {
  const [y, m, d] = iso.split("-").map(Number);
  const month = MONTH_NAMES[m - 1];
  return [iso, `${month} ${d}`, `${month.slice(0, 3)} ${d}`, `${m}/${d}/${y}`, `${m}/${d}`];
}

/** Every fixture value that must not appear in a reply before verification. */
function protectedValues(): string[] {
  const values: string[] = [];
  for (const c of claims) {
    values.push(c.case_id, c.summary, c.created_at);
    values.push(...dateVariants(c.created_at));
    if (c.appeal_deadline) values.push(...dateVariants(c.appeal_deadline));
    if (c.denial_reason) values.push(c.denial_reason);
    values.push(...(c.documents_needed ?? []));
    for (const a of [c.expected_reimbursement_amount, c.allowed_max_amount, c.net_pay, c.net_fee]) {
      values.push(...amountVariants(a));
    }
  }
  for (const p of policyholders) {
    values.push(p.name, ...(p.name_aliases ?? []), p.policy_number, p.dob, p.id_last4, p.email, ...(p.email_aliases ?? []));
    values.push(p.phone.slice(-10), ...(p.phone_aliases ?? []).map((x) => x.slice(-10)));
  }
  for (const r of representatives) values.push(r.rep_name);
  // Status words that would confirm a claim's outcome.
  values.push("denied", "settled", "in progress");
  return [...new Set(values.map(norm).filter((v) => v.length >= 3))];
}

const PROTECTED = protectedValues();

function containsValue(haystack: string, value: string): boolean {
  // Word-ish boundaries so "4472" doesn't fire inside "144720".
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(haystack);
}

export type LeakCheck = { leaked: boolean; hits: string[] };

/**
 * `callerTexts` are everything the caller has typed this session. Echoing
 * their own words back ("Thanks, Margaret Chen") is a confirmation, not a
 * leak, so those values are excluded.
 */
export function leakCheck(reply: string, callerTexts: string[]): LeakCheck {
  const r = norm(reply);
  const said = norm(callerTexts.join(" \n "));
  const digitsSaid = said.replace(/\D/g, "");
  const hits = new Set<string>();

  for (const v of PROTECTED) {
    if (!containsValue(r, v)) continue;
    // Pure-digit values (phone, last 4) count as said even if typed with punctuation.
    const callerSaidIt = containsValue(said, v) || (/^\d{4,}$/.test(v) && digitsSaid.includes(v));
    if (!callerSaidIt) hits.add(v);
  }
  for (const m of r.matchAll(/cl-\d{3,}/g)) {
    if (!said.includes(m[0])) hits.add(m[0]);
  }
  if (/\$\s?\d/.test(r)) hits.add("dollar amount");

  return { leaked: hits.size > 0, hits: [...hits] };
}

const idKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Policy numbers and claim IDs in the reply that don't belong to the verified caller. */
export function idCheck(reply: string, partyId: string): string[] {
  const holder = findPolicyholder(partyId);
  const allowed = new Set([holder?.policy_number ?? "", ...claimsForParty(partyId).map((c) => c.case_id)].filter(Boolean).map(idKey));
  const policyDigits = holder ? idKey(holder.policy_number).replace(/\D/g, "") : "";
  const bad = new Set<string>();
  // Anything shaped like an ID: POL-9921, CL-2048, "POL 9921".
  for (const m of reply.matchAll(/\b(?:POL|CL)[\s-]?\d{3,}\b/gi)) {
    if (!allowed.has(idKey(m[0]))) bad.add(m[0]);
  }
  // A policy number stated without the prefix: "your policy number is 55821".
  for (const m of reply.matchAll(/policy (?:number|no\.?|#)\s*(?:is|of|:)?\s*#?\s*([A-Z]*[\s-]?\d[\d-]{2,})/gi)) {
    const k = idKey(m[1]);
    if (!allowed.has(k) && k.replace(/\D/g, "") !== policyDigits) bad.add(m[1].trim());
  }
  return [...bad];
}

export type GroundingCheck = { ungrounded: string[] };

/** Amounts and dates in the reply that aren't in `allowed` (the data the reply was built from). */
export function groundingCheck(reply: string, allowed: { amounts: string[]; dates: string[] }): GroundingCheck {
  const ungrounded: string[] = [];
  const allowedAmounts = new Set(allowed.amounts.map((a) => Number(a)));
  for (const m of reply.matchAll(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/g)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!allowedAmounts.has(n)) ungrounded.push(m[0]);
  }

  const allowedMonthDay = new Set(
    allowed.dates.map((iso) => {
      const [, mo, d] = iso.split("-").map(Number);
      return `${mo}-${d}`;
    }),
  );
  const lower = reply.toLowerCase();
  for (const m of lower.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    if (!allowedMonthDay.has(`${+m[2]}-${+m[3]}`)) ungrounded.push(m[0]);
  }
  const monthRe = new RegExp(`\\b(${MONTH_NAMES.join("|")}|${MONTH_NAMES.map((x) => x.slice(0, 3)).join("|")})\\.? (\\d{1,2})\\b`, "g");
  for (const m of lower.matchAll(monthRe)) {
    const mo = MONTH_NAMES.findIndex((x) => x.startsWith(m[1].slice(0, 3))) + 1;
    if (!allowedMonthDay.has(`${mo}-${+m[2]}`)) ungrounded.push(m[0]);
  }
  return { ungrounded };
}
