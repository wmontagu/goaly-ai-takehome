import { describe, expect, it } from "vitest";
import { matchIdentity, normalizeDob, normalizePhone } from "@/lib/domain/identity";

describe("normalizeDob", () => {
  it.each([
    ["1985-03-15", "1985-03-15"],
    ["3/15/1985", "1985-03-15"],
    ["03-15-85", "1985-03-15"],
    ["March 15 1985", "1985-03-15"],
    ["March 15th, 1985", "1985-03-15"],
    ["15 March 1985", "1985-03-15"],
    ["Mar 15, 1985", "1985-03-15"],
  ])("%s → %s", (raw, iso) => {
    expect(normalizeDob(raw)).toBe(iso);
  });

  it("rejects impossible dates", () => {
    expect(normalizeDob("1985-02-30")).toBeNull();
    expect(normalizeDob("not a date")).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("compares the last 10 digits", () => {
    expect(normalizePhone("+1 (650) 521-2836")).toBe("6505212836");
    expect(normalizePhone("650.521.2836")).toBe("6505212836");
  });
});

describe("matchIdentity", () => {
  it("verifies Margaret with name + DOB + SSN last 4", () => {
    const r = matchIdentity({ name: "Margaret Chen", dob: "1985-03-15", id_last4: "4472" });
    expect(r.verified).toBe(true);
    expect(r.candidatePartyId).toBe("P9");
  });

  it("counts the policy number as one of the 3 factors (name + policy + DOB passes)", () => {
    const r = matchIdentity({ name: "margaret chen", policy_number: "POL-9921", dob: "March 15, 1985" });
    expect(r.verified).toBe(true);
    expect(r.matched).toContain("policy_number");
  });

  it("does not verify with only 2 matching fields", () => {
    const r = matchIdentity({ name: "Margaret Chen", policy_number: "pol 9921" });
    expect(r.verified).toBe(false);
    expect(r.matched).toHaveLength(2);
  });

  it("rejects a contradicting field even with 3 matches", () => {
    const r = matchIdentity({
      name: "Margaret Chen",
      policy_number: "POL-9921",
      id_last4: "4472",
      dob: "1990-01-01",
    });
    expect(r.verified).toBe(false);
    expect(r.mismatched).toEqual(["dob"]);
  });

  it("rejects fields that belong to two different records", () => {
    // Margaret's name + DOB, Ava's SSN last 4.
    const r = matchIdentity({ name: "Margaret Chen", dob: "1985-03-15", id_last4: "9180" });
    expect(r.verified).toBe(false);
    expect(r.mismatched).toEqual(["id_last4"]);
  });

  it("accepts a national ID last 4 for Ma Tian", () => {
    const r = matchIdentity({ name: "Ma Tian", dob: "1964-09-10", id_last4: "6688" });
    expect(r.verified).toBe(true);
    expect(r.candidateIdType).toBe("national_id_last4");
  });

  it("accepts name, phone, and email aliases for Ya Wen Li", () => {
    const r = matchIdentity({ name: "Yaven Li", phone: "650-521-2830", email: "YAWEN.LI@example.com" });
    expect(r.verified).toBe(true);
    expect(r.candidatePartyId).toBe("P13");
  });

  it("verifies without the SSN using phone + email + name", () => {
    const r = matchIdentity({ name: "Margaret Chen", phone: "(650) 521-2836", email: "margaret@email.com" });
    expect(r.verified).toBe(true);
  });

  it("has no candidate when nothing matches", () => {
    const r = matchIdentity({ name: "Nobody Here", dob: "2000-01-01" });
    expect(r.candidatePartyId).toBeNull();
    expect(r.verified).toBe(false);
  });
});
