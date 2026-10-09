import { describe, expect, it } from "vitest";
import { GATE_FOR } from "@/lib/sop/gates";
import { mergeUnderstanding } from "@/lib/sop/memory";
import { createSession, type Session } from "@/lib/sop/session";
import type { Understanding } from "@/lib/sop/understanding";
import { u } from "./helpers";

/** Runs one VERIFY_ID turn the way the engine does: merge, then gate. */
function verifyTurn(s: Session, understanding: Understanding) {
  s.turn += 1;
  mergeUnderstanding(s.memory, understanding, s.turn);
  const r = GATE_FOR.VERIFY_ID(s, { u: understanding, startedHere: true });
  if (r.status === "stay") s.memory.verify_asks += 1; // the reply asks again
  return r;
}

describe("VERIFY_ID gate", () => {
  it("passes on any 3 matching fields and records the party", () => {
    const s = createSession();
    const r = verifyTurn(s, u({ identity: { name: "Margaret Chen", policy_number: "POL-9921", dob: "1985-03-15" } }));
    expect(r.status).toBe("pass");
    expect(s.memory.verified_party_id).toBe("P9");
  });

  it("the first ask is free; a re-ask that adds nothing counts as a failure", () => {
    const s = createSession();
    verifyTurn(s, u({ intent: "denial_question" })); // first message, no PII: free
    expect(s.memory.strikes.verify_fail).toBe(0);
    const r = verifyTurn(s, u({ intent: "denial_question" })); // asked, still nothing
    expect(s.memory.strikes.verify_fail).toBe(1);
    expect(r.status === "stay" && r.missing.kind === "identity" && r.missing.failure_this_turn).toBe("still_short");
  });

  it("does not punish progress: one new matching field per turn is fine", () => {
    const s = createSession();
    verifyTurn(s, u({ identity: { name: "Margaret Chen" } }));
    verifyTurn(s, u({ identity: { dob: "1985-03-15" } }));
    const r = verifyTurn(s, u({ identity: { phone: "650-521-2836" } }));
    expect(r.status).toBe("pass");
    expect(s.memory.strikes.verify_fail).toBe(0);
  });

  it("clarifying questions and off-topic turns are exempt", () => {
    const s = createSession();
    verifyTurn(s, u({ identity: { name: "Margaret Chen" } }));
    verifyTurn(s, u({ asks_about_process: true }));
    verifyTurn(s, u({ scope: "out_of_scope" }));
    expect(s.memory.strikes.verify_fail).toBe(0);
  });

  it("refusal counts, and the caller is never stuck: other fields still verify", () => {
    const s = createSession();
    verifyTurn(s, u({ identity: { name: "Margaret Chen" }, refuses_identity: true, emotion: "refusing" }));
    expect(s.memory.strikes.verify_fail).toBe(1);
    const r = verifyTurn(s, u({ identity: { phone: "6505212836", email: "margaret@email.com" } }));
    expect(r.status).toBe("pass");
  });

  it("a contradicting field counts as a mismatch and never says which", () => {
    const s = createSession();
    const r = verifyTurn(s, u({ identity: { name: "Margaret Chen", policy_number: "POL-9921", dob: "1990-01-01" } }));
    expect(r.status).toBe("stay");
    if (r.status !== "stay" || r.missing.kind !== "identity") throw new Error("expected identity stay");
    expect(r.missing.failure_this_turn).toBe("mismatch");
    // Only what was provided, never which provided field was wrong.
    expect(r.missing.provided.sort()).toEqual(["dob", "name", "policy_number"]);
    expect(r.missing).not.toHaveProperty("mismatched");
    expect(r.missing).not.toHaveProperty("matched");
  });

  it("3 failures escape to a human transfer", () => {
    const s = createSession();
    verifyTurn(s, u({ refuses_identity: true }));
    verifyTurn(s, u({ refuses_identity: true }));
    const r = verifyTurn(s, u({ refuses_identity: true }));
    expect(r).toEqual({ status: "escape", to: "TRANSFERRED", reason: "verification_failed" });
  });

  it("a listed representative needs consent; the default scenario approves on the 2nd poll", () => {
    const s = createSession("default");
    const id = { name: "Margaret Chen", dob: "1985-03-15", id_last4: "4472" };
    const first = verifyTurn(
      s,
      u({ identity: id, caller_role: "representative", rep_name: "David Chen", rep_relationship: "son" }),
    );
    expect(first.status === "stay" && first.missing.kind).toBe("consent_pending");
    expect(s.memory.verified_party_id).toBeUndefined();
    const second = verifyTurn(s, u({}));
    expect(second.status).toBe("pass");
  });

  it("the timeout consent scenario escapes to a human", () => {
    const s = createSession("timeout");
    const rep = u({
      identity: { name: "Margaret Chen", dob: "1985-03-15", id_last4: "4472" },
      caller_role: "representative",
      rep_name: "David Chen",
      rep_relationship: "son",
    });
    let r = verifyTurn(s, rep);
    for (let i = 0; i < 5 && r.status === "stay"; i++) r = verifyTurn(s, u({ asks_about_process: true }));
    expect(r).toMatchObject({ status: "escape", reason: "consent_timeout" });
  });
});

describe("RESOLVE_INTENT gate", () => {
  it("uses hints remembered during verification", () => {
    const s = createSession();
    s.memory.verified_party_id = "P9";
    s.phase = "RESOLVE_INTENT";
    mergeUnderstanding(
      s.memory,
      u({ intent: "denial_question", case_hints: { status: "denied", case_type: "healthcare", month: 1 } }),
      1,
    );
    const r = GATE_FOR.RESOLVE_INTENT(s, { u: u(), startedHere: false });
    expect(r.status).toBe("pass");
    expect(s.memory.selected_case_id).toBe("CL-2048");
  });

  it("asks to disambiguate between candidates", () => {
    const s = createSession();
    s.memory.verified_party_id = "P9";
    s.phase = "RESOLVE_INTENT";
    mergeUnderstanding(s.memory, u({ intent: "status_inquiry", case_hints: { case_type: "healthcare" } }), 1);
    const r = GATE_FOR.RESOLVE_INTENT(s, { u: u(), startedHere: true });
    if (r.status !== "stay" || r.missing.kind !== "case") throw new Error("expected case stay");
    expect(r.missing.candidates.map((c) => c.case_id)).toEqual(["CL-2048", "CL-2011"]);
  });
});

describe("POST_PROCESS gate", () => {
  it("offers first, then needs an explicit yes/no; two unclear answers mean skip", () => {
    const s = createSession();
    s.phase = "POST_PROCESS";
    expect(GATE_FOR.POST_PROCESS(s, { u: u(), startedHere: false }).status).toBe("stay");
    expect(GATE_FOR.POST_PROCESS(s, { u: u({ email_decision: "unclear" }), startedHere: true }).status).toBe("stay");
    const r = GATE_FOR.POST_PROCESS(s, { u: u({ email_decision: "unclear" }), startedHere: true });
    expect(r.status).toBe("pass");
    expect(s.memory.email.decision).toBe("skip");
  });
});
