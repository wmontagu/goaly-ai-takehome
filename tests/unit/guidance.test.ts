import { describe, expect, it } from "vitest";
import { findClaim } from "@/apps/insurance_claims/data";
import { deadlineInfo, documentGuidance, matchFollowups } from "@/lib/domain/guidance";
import { maskEmail, renderEmail } from "@/lib/domain/email-summary";

const cl2048 = findClaim("P9", "CL-2048")!;

describe("documentGuidance", () => {
  it("resolves the loose claim doc names to guideline keys", () => {
    const docs = documentGuidance(cl2048);
    expect(docs.map((d) => d.canonical)).toEqual(["original pathology report", "treating provider office note"]);
    expect(docs.every((d) => d.how_to_prepare)).toBe(true);
  });
});

describe("matchFollowups", () => {
  it("matches processing time and fills templates", () => {
    const { matches } = matchFollowups("How long does it take after I submit?", "next_steps", cl2048);
    const t = matches.find((m) => m.topic === "processing_time_after_submission")!;
    expect(t.text).toContain("CL-2048");
    expect(t.text).toContain("usually less than a week");
    expect(t.text).toContain("the pathology report and the office note");
    expect(t.text).not.toMatch(/\{\w+\}/);
  });

  it("matches the alternatives topic, which has no match_any in the fixture", () => {
    const { matches } = matchFollowups("I don't have the office note", "document_submission", cl2048);
    expect(matches.map((m) => m.topic)).toContain("missing_required_material_alternatives");
  });

  it("returns only the fallback when nothing matches", () => {
    const { matches, fallback } = matchFollowups("will it rain", "general_claim_question", cl2048);
    expect(matches).toEqual([]);
    expect(fallback).toMatch(/claim-specific rule/);
  });
});

describe("deadlineInfo", () => {
  it("computes days remaining against a fixed today", () => {
    expect(deadlineInfo(cl2048, "2026-03-01")).toEqual({ date: "2026-03-18", days_remaining: 17, passed: false });
    expect(deadlineInfo(cl2048, "2026-04-01")?.passed).toBe(true);
  });
});

describe("email summary", () => {
  it("masks the email and renders a fixed template", () => {
    expect(maskEmail("margaret@email.com")).toBe("m*******@email.com");
    const out = renderEmail(
      { subject: "Your claim CL-2048", discussed: ["Why CL-2048 was denied"], claim_status_outcome: "Denied", next_steps: ["Upload the pathology report"] },
      { firstName: "Margaret", caseId: "CL-2048" },
    );
    expect(out.text).toContain("Hi Margaret,");
    expect(out.text).toContain("Upload the pathology report");
    expect(out.html).toContain("<li>Why CL-2048 was denied</li>");
  });
});
