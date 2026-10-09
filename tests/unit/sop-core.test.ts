import { describe, expect, it } from "vitest";
import { groundingCheck, leakCheck } from "@/lib/sop/filter";
import { mergeUnderstanding } from "@/lib/sop/memory";
import { createSession } from "@/lib/sop/session";
import { canTransition, IllegalTransition, transition } from "@/lib/sop/state-machine";
import { getClaims, ToolRejected } from "@/lib/tools";
import { u } from "./helpers";

describe("state machine", () => {
  it("has no edge that skips a phase", () => {
    expect(canTransition("VERIFY_ID", "PROCESS_CASE")).toBe(false);
    expect(canTransition("VERIFY_ID", "POST_PROCESS")).toBe(false);
    expect(canTransition("RESOLVE_INTENT", "POST_PROCESS")).toBe(false);
  });

  it("can't reach RESOLVE_INTENT or PROCESS_CASE without a verified party", () => {
    const s = createSession();
    expect(() => transition(s, "RESOLVE_INTENT", "test")).toThrow(IllegalTransition);
    s.memory.verified_party_id = "P9";
    transition(s, "RESOLVE_INTENT", "test");
    expect(() => transition(s, "PROCESS_CASE", "test")).toThrow(/selected case/);
  });

  it("terminal phases have no exits", () => {
    expect(canTransition("TRANSFERRED", "VERIFY_ID")).toBe(false);
    expect(canTransition("ENDED", "VERIFY_ID")).toBe(false);
  });
});

describe("tool allowlist", () => {
  it("rejects claim lookups during VERIFY_ID and logs it", () => {
    const s = createSession();
    s.memory.verified_party_id = "P9"; // even with a party set, the phase forbids it
    expect(() => getClaims(s)).toThrow(ToolRejected);
    expect(s.trace.at(-1)?.kind).toBe("tool_rejected");
  });
});

describe("memory", () => {
  it("stores a later-phase hint during verification", () => {
    const s = createSession();
    const changes = mergeUnderstanding(
      s.memory,
      u({ intent: "denial_question", case_hints: { status: "denied", case_type: "healthcare", month: 1 } }),
      1,
    );
    expect(s.phase).toBe("VERIFY_ID");
    expect(s.memory.case_hints).toEqual({ status: "denied", case_type: "healthcare", month: 1 });
    expect(changes.map((c) => c.field)).toContain("intent");
  });

  it("replace mode drops stale hints when the caller switches claims", () => {
    const s = createSession();
    mergeUnderstanding(s.memory, u({ case_hints: { status: "denied", case_type: "healthcare" } }), 1);
    mergeUnderstanding(s.memory, u({ case_hints: { case_type: "auto" } }), 2, "replace");
    expect(s.memory.case_hints).toEqual({ case_type: "auto" });
  });
});

describe("leakCheck (pre-verification)", () => {
  const callerSaid = ["My name is Margaret Chen, policy POL-9921, about my denied healthcare claim"];

  it("blocks claim details the caller didn't say", () => {
    const r = leakCheck("Your claim CL-2048 was denied because the pathology report is missing.", callerSaid);
    expect(r.leaked).toBe(true);
    expect(r.hits).toEqual(expect.arrayContaining(["cl-2048", "pathology report"]));
  });

  it("blocks dollar amounts and claim dates", () => {
    expect(leakCheck("It was for $1,450.", callerSaid).leaked).toBe(true);
    expect(leakCheck("I see a claim from January 12.", callerSaid).leaked).toBe(true);
  });

  it("allows echoing what the caller typed", () => {
    const r = leakCheck("Thanks, Margaret Chen. I have policy POL-9921 and that you're asking about a denied claim.", callerSaid);
    expect(r.leaked).toBe(false);
  });

  it("catches another policyholder's data", () => {
    expect(leakCheck("Is this Ava Lopez?", callerSaid).leaked).toBe(true);
  });
});

describe("groundingCheck (post-verification)", () => {
  const allowed = { amounts: ["0.00", "1450.00"], dates: ["2026-01-12", "2026-03-18"] };

  it("passes amounts and dates from the record", () => {
    expect(groundingCheck("Allowed max was $1,450.00; appeal by March 18.", allowed).ungrounded).toEqual([]);
  });

  it("flags invented amounts and dates", () => {
    expect(groundingCheck("You'll get $900 by April 2.", allowed).ungrounded).toEqual(["$900", "april 2"]);
  });
});
