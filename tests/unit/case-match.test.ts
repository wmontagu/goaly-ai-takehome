import { describe, expect, it } from "vitest";
import { resolveCase } from "@/lib/domain/case-match";

describe("resolveCase", () => {
  it("denied + healthcare + January → CL-2048", () => {
    expect(resolveCase("P9", { status: "denied", case_type: "healthcare", month: 1 })).toEqual({
      kind: "selected",
      caseId: "CL-2048",
      via: "hints",
    });
  });

  it("'my healthcare claim' is ambiguous between CL-2048 and CL-2011", () => {
    const r = resolveCase("P9", { case_type: "healthcare" });
    expect(r).toEqual({ kind: "ambiguous", candidates: ["CL-2048", "CL-2011"] });
  });

  it("'auto' → CL-2102", () => {
    expect(resolveCase("P9", { case_type: "auto" })).toMatchObject({ kind: "selected", caseId: "CL-2102" });
  });

  it("an explicit case ID wins, with loose formatting", () => {
    expect(resolveCase("P9", { case_id: "cl 1899" })).toMatchObject({ kind: "selected", caseId: "CL-1899" });
  });

  it("never returns another party's case", () => {
    // CL-3001 belongs to P12.
    const r = resolveCase("P9", { case_id: "CL-3001" });
    expect(r.kind).toBe("none");
    expect(JSON.stringify(r)).not.toContain("CL-3001");
  });

  it("no hints → none, listing only this party's claims", () => {
    const r = resolveCase("P12", {});
    expect(r).toEqual({ kind: "none", candidates: ["CL-3001"] });
  });
});
