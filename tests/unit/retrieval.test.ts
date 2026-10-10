import { describe, expect, it } from "vitest";
import { claims, claimsForParty, guideline, policyholders } from "@/apps/insurance_claims/data";
import { buildChunks, retrieve } from "@/lib/domain/retrieval";

// Expectations come from the data, not hardcoded IDs: any fixture set with
// two parties who have claims exercises the same behaviour.
const withClaims = policyholders.filter((p) => claimsForParty(p.party_id).length > 0);
const [me, other] = withClaims;

describe("chunking", () => {
  it("covers every record: one account per person, overview + amounts per claim, every guide entry", () => {
    const ids = buildChunks().map((c) => c.id);
    for (const p of policyholders) expect(ids).toContain(`account:${p.party_id}`);
    for (const c of claims) {
      expect(ids).toContain(`claim:${c.case_id}:overview`);
      expect(ids).toContain(`claim:${c.case_id}:amounts`);
    }
    for (const doc of Object.keys(guideline.document_guidance)) expect(ids).toContain(`guide:document:${doc}`);
  });

  it("account chunks never carry DOB or ID digits", () => {
    for (const p of policyholders) {
      const chunk = buildChunks().find((c) => c.id === `account:${p.party_id}`)!;
      expect(chunk.text).not.toContain(p.dob);
      expect(chunk.text).not.toContain(p.id_last4);
    }
  });
});

describe("BM25 retrieval, scoped to the verified caller", () => {
  it("answers 'what's my policy number' from the caller's own account", () => {
    const top = retrieve("what's my policy number?", me.party_id)[0];
    expect(top.id).toBe(`account:${me.party_id}`);
    expect(top.text).toContain(me.policy_number);
  });

  it("finds the claim the caller describes, by its words", () => {
    const claim = claimsForParty(me.party_id).find((c) => c.denial_reason)!;
    const ids = retrieve(`why was my ${claim.case_type} claim denied?`, me.party_id).map((r) => r.id);
    expect(ids).toContain(`claim:${claim.case_id}:denial`);
  });

  it("never returns another person's records, even on a direct match", () => {
    const theirs = claimsForParty(other.party_id)[0];
    const results = retrieve(`${other.name} ${other.policy_number} ${theirs.case_id} ${theirs.summary}`, me.party_id);
    const mine = new Set(["public", me.party_id]);
    const owners = buildChunks().filter((c) => results.some((r) => r.id === c.id)).map((c) => c.owner);
    expect(owners.every((o) => mine.has(o))).toBe(true);
    expect(results.map((r) => r.text).join(" ")).not.toContain(theirs.case_id);
  });

  it("pulls shared guidance for a missing document", () => {
    const doc = Object.keys(guideline.document_alternative_guidance).find((d) => d !== "default")!;
    const ids = retrieve(`I don't have the ${doc}, what can I do?`, me.party_id).map((r) => r.id);
    expect(ids).toContain(`guide:alternative:${doc}`);
  });

  it("returns nothing for an empty or all-stopword question", () => {
    expect(retrieve("", me.party_id)).toEqual([]);
    expect(retrieve("what is the", me.party_id)).toEqual([]);
  });
});
