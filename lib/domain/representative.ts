/**
 * Third-party callers (SPEC §6.3): a rep is valid only if representatives.json
 * lists them for that policyholder, and they still need consent to proceed.
 */
import { consentScenarios, representatives, type ConsentScenarioName, type ConsentStatus } from "@/apps/insurance_claims/data";
import { normalizeName } from "./identity";

export function isListedRepresentative(partyId: string, repName?: string, relationship?: string): boolean {
  if (!repName) return false;
  return representatives.some(
    (r) =>
      r.buyer_party_id === partyId &&
      normalizeName(r.rep_name) === normalizeName(repName) &&
      (!relationship || r.relationship.toLowerCase() === relationship.trim().toLowerCase()),
  );
}

/** The status the Nth consent poll returns. Past the sequence end, it stays at the last value. */
export function consentStatusAt(scenario: ConsentScenarioName, poll: number): ConsentStatus {
  const seq = consentScenarios[scenario].status_sequence;
  return seq[Math.min(poll, seq.length - 1)];
}

/** True once a scenario has run out of statuses and is still pending: a timeout. */
export function consentTimedOut(scenario: ConsentScenarioName, polls: number): boolean {
  const seq = consentScenarios[scenario].status_sequence;
  return polls >= seq.length && seq[seq.length - 1] === "pending";
}
