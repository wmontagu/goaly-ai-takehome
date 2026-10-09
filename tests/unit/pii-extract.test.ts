import { describe, expect, it } from "vitest";
import { backfillIdentity } from "@/lib/domain/pii-extract";

describe("backfillIdentity", () => {
  it("recovers a DOB and last 4 the model dropped", () => {
    const text = "Hi, I'm David Chen, her son, calling for Margaret Chen. DOB 1985-03-15, SSN last four 4472.";
    expect(backfillIdentity(text, { name: "Margaret Chen" })).toEqual({ dob: "1985-03-15", id_last4: "4472" });
  });

  it("reads spoken dates and other labels", () => {
    expect(backfillIdentity("I was born on March 15, 1985", {})).toEqual({ dob: "March 15, 1985" });
    expect(backfillIdentity("date of birth is 3/15/1985", {})).toEqual({ dob: "3/15/1985" });
    expect(backfillIdentity("my national ID ends in 6688", {})).toEqual({ id_last4: "6688" });
  });

  it("finds email, phone, and policy number by shape", () => {
    expect(
      backfillIdentity("policy pol 9921, phone (650) 521-2836, email Margaret@Email.com", {}),
    ).toEqual({ email: "Margaret@Email.com", policy_number: "pol 9921", phone: "(650) 521-2836" });
  });

  it("never overrides what the model extracted", () => {
    expect(backfillIdentity("DOB 1985-03-15", { dob: "1985-03-15" })).toEqual({});
  });

  it("ignores unlabeled dates (a claim date is not a DOB)", () => {
    expect(backfillIdentity("my claim from 2026-01-12 was denied", {})).toEqual({});
  });

  it("doesn't mistake a claim number for an ID last 4", () => {
    expect(backfillIdentity("my claim id is CL-2048", {})).toEqual({});
    expect(backfillIdentity("case id 2048", {})).toEqual({});
  });

  it("ignores invalid dates", () => {
    expect(backfillIdentity("DOB 1985-02-30", {})).toEqual({});
  });
});
