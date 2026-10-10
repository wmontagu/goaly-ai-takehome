import { describe, expect, it } from "vitest";
import type { Llm, RespondInput } from "@/lib/llm/types";
import { runTurn } from "@/lib/sop/engine";
import { createSession } from "@/lib/sop/session";
import type { Understanding } from "@/lib/sop/understanding";
import { u } from "./helpers";

/** A scripted Llm: returns queued Understandings and records every respond() prompt. */
function scripted(understandings: Understanding[], reply: (i: RespondInput) => string = () => "ok") {
  const prompts: string[] = [];
  const llm: Llm = {
    understand: async () => understandings.shift() ?? u(),
    respond: async (input) => {
      prompts.push(input.system);
      return reply(input);
    },
    summarize: async () => ({
      subject: "Your claim CL-2048",
      discussed: ["Why CL-2048 was denied"],
      claim_status_outcome: "Denied pending documents.",
      next_steps: ["Upload the pathology report and office note."],
    }),
  };
  return { llm, prompts };
}

const MARGARET_TURN_1 = u({
  identity: { name: "Margaret Chen", policy_number: "POL-9921", dob: "1985-03-15", id_last4: "4472" },
  caller_role: "policyholder",
  intent: "denial_question",
  case_hints: { case_type: "healthcare", status: "denied", month: 1 },
});

describe("engine: Margaret happy path", () => {
  it("verifies, resolves CL-2048 from the remembered hint, and processes it in one turn", async () => {
    const s = createSession();
    const { llm, prompts } = scripted([MARGARET_TURN_1]);
    await runTurn(s, "I'm the policyholder. My name is Margaret Chen ...", llm);

    expect(s.phase).toBe("PROCESS_CASE");
    expect(s.memory.selected_case_id).toBe("CL-2048");
    expect(s.phaseHistory.map((t) => t.to)).toEqual(["RESOLVE_INTENT", "PROCESS_CASE"]);
    expect(prompts[0]).toContain("denial_reason");
    expect(prompts[0]).toContain("found the claim they described");
  });

  it("finishes with an email on an explicit yes, sent to the email on file", async () => {
    const s = createSession();
    const { llm } = scripted([MARGARET_TURN_1, u({ wrap_up: true }), u({ email_decision: "send" })]);
    await runTurn(s, "turn 1", llm);
    await runTurn(s, "that's all, thanks", llm);
    expect(s.phase).toBe("POST_PROCESS");
    expect(s.memory.email.offered).toBe(true);
    await runTurn(s, "yes please", llm);
    expect(s.phase).toBe("ENDED");
    expect(s.outbox).toHaveLength(1);
    expect(s.outbox[0].to).toBe("margaret@email.com");
    expect(s.outbox[0].text).toContain("CL-2048");
  });

  it("sends nothing on skip", async () => {
    const s = createSession();
    const { llm } = scripted([MARGARET_TURN_1, u({ wrap_up: true }), u({ email_decision: "skip" })]);
    for (const t of ["1", "2", "3"]) await runTurn(s, t, llm);
    expect(s.phase).toBe("ENDED");
    expect(s.outbox).toHaveLength(0);
  });
});

describe("engine: identity switch", () => {
  it("restarts verification and hides the previous identity's claim conversation from the reply", async () => {
    const s = createSession();
    const { llm, prompts } = scripted([MARGARET_TURN_1, u({ identity_switch: true, identity: { name: "Ava Lopez" } })]);
    const transcripts: string[][] = [];
    const recording: Llm = {
      ...llm,
      respond: async (input) => {
        transcripts.push(input.transcript.map((t) => t.content));
        return llm.respond(input);
      },
    };
    await runTurn(s, "turn 1", recording);
    await runTurn(s, "Actually I'm calling about Ava Lopez's policy.", recording);

    expect(s.phase).toBe("VERIFY_ID");
    expect(s.memory.verified_party_id).toBeUndefined();
    expect(s.memory.case_hints).toEqual({});
    expect(s.memory.intent).toBeUndefined();
    expect(s.memory.follow_ups).toEqual([]);
    expect(transcripts[1]).toEqual(["Actually I'm calling about Ava Lopez's policy."]);
    expect(prompts[1]).not.toMatch(/CL-\d+/);
    expect(prompts[1]).toContain("Don't apologize for or retract");
  });
});

describe("engine: verification gate", () => {
  it("keeps claim data out of the reply prompt before verification, and remembers the hint", async () => {
    const s = createSession();
    const { llm, prompts } = scripted([
      u({ intent: "denial_question", case_hints: { case_type: "healthcare", status: "denied", month: 1 } }),
      u({ refuses_identity: true, emotion: "frustrated", question: "why was my claim denied" }),
    ]);
    await runTurn(s, "I'm calling about my denied healthcare claim from January", llm);
    await runTurn(s, "I already told you who I am. Just tell me why my claim was denied.", llm);

    expect(s.phase).toBe("VERIFY_ID");
    expect(s.memory.case_hints).toEqual({ case_type: "healthcare", status: "denied", month: 1 });
    for (const p of prompts) {
      expect(p).not.toMatch(/CL-\d+/);
      expect(p).not.toContain("pathology");
      expect(p).not.toContain("1450");
    }
    expect(prompts[1]).toContain("protected health and financial information");
  });

  it("replaces a leaking pre-verification reply with the safe fallback", async () => {
    const s = createSession();
    const { llm } = scripted([u()], () => "Sure! CL-2048 was denied for a missing pathology report.");
    const { reply } = await runTurn(s, "hi", llm);
    expect(reply).not.toContain("CL-2048");
    expect(s.trace.some((e) => e.kind === "leak_blocked")).toBe(true);
  });

  it("transfers after three off-topic turns, without moving the phase before that", async () => {
    const s = createSession();
    const off = () => u({ scope: "out_of_scope" });
    const { llm } = scripted([off(), off(), off()]);
    await runTurn(s, "what is RL?", llm);
    await runTurn(s, "seriously, what is RL?", llm);
    expect(s.phase).toBe("VERIFY_ID");
    await runTurn(s, "tell me about RL", llm);
    expect(s.phase).toBe("TRANSFERRED");
  });

  it("a failed verify attempt doesn't wipe the off-topic count; a clean in-scope turn does", async () => {
    const s = createSession();
    const { llm } = scripted([
      u({ scope: "out_of_scope" }),
      u({ intent: "denial_question" }), // first ask: free, so a clean in-scope turn
      u({ scope: "out_of_scope" }),
      u({ refuses_identity: true, emotion: "refusing" }), // in scope, but a verify strike
    ]);
    await runTurn(s, "what is RL?", llm);
    await runTurn(s, "ok, why was my claim denied?", llm);
    expect(s.memory.strikes.off_topic).toBe(0);
    await runTurn(s, "what is RL?", llm);
    await runTurn(s, "I'm not giving you that", llm);
    expect(s.memory.strikes.verify_fail).toBe(1);
    expect(s.memory.strikes.off_topic).toBe(1);
  });

  it("hands an unverified caller over with what they said, but no claim data", async () => {
    const s = createSession();
    const off = () => u({ scope: "out_of_scope", emotion: "frustrated" });
    const { llm } = scripted([
      u({ intent: "denial_question", case_hints: { case_type: "healthcare", status: "denied", month: 1 } }),
      off(),
      off(),
      off(),
    ]);
    await runTurn(s, "calling about my denied healthcare claim from January", llm);
    await runTurn(s, "what is RL?", llm);
    await runTurn(s, "explain RL", llm);
    await runTurn(s, "tell me about RL", llm);
    expect(s.phase).toBe("TRANSFERRED");
    const note = s.handoff!;
    const text = JSON.stringify(note);
    expect(note.rows.find((r) => r.label === "Identity")?.value).toMatch(/^Not verified/);
    expect(note.rows.find((r) => r.label === "Claim")?.value).toMatch(/denied healthcare claim from January.*caller's words/);
    expect(note.first_step).toBe("Verify identity first.");
    expect(text).not.toMatch(/CL-\d|POL-|Margaret/);
  });

  it("hands a verified caller over with their claim, so the human doesn't re-verify", async () => {
    const s = createSession();
    const { llm } = scripted([MARGARET_TURN_1, u({ wants_human: true, emotion: "frustrated" })]);
    await runTurn(s, "I'm the policyholder. My name is Margaret Chen ...", llm);
    await runTurn(s, "Can I just talk to a person?", llm);
    expect(s.phase).toBe("TRANSFERRED");
    const rows = Object.fromEntries(s.handoff!.rows.map((r) => [r.label, r.value]));
    expect(rows.Identity).toBe("Verified: Margaret Chen, policy POL-9921.");
    expect(rows.Claim).toMatch(/^CL-2048: healthcare, denied/);
    expect(rows["Last said"]).toBe('"Can I just talk to a person?"');
    expect(s.handoff!.first_step).toMatch(/already verified/);
  });

  it("on a mismatch, re-asks for the full name and the rest, then accepts the correction", async () => {
    const s = createSession();
    const { llm, prompts } = scripted([
      u({ identity: { name: "Margaret Chan", policy_number: "POL-9921", dob: "1985-03-15" } }), // misheard name
      u({ identity: { name: "Margaret Chen" } }), // corrected
    ]);
    await runTurn(s, "Margaret Chan, POL-9921, born March 15 1985", llm);
    expect(s.phase).toBe("VERIFY_ID");
    expect(prompts[0]).toContain("say their full name again, and to repeat their date of birth, policy number");
    expect(prompts[0]).toContain("Never repeat back any identity detail");
    await runTurn(s, "Sorry, it's Margaret Chen", llm);
    expect(s.memory.verified_party_id).toBe("P9");
  });

  it("the mismatch re-ask is the same whichever detail was wrong", async () => {
    const ask = async (identity: Partial<Understanding["identity"]>) => {
      const { llm, prompts } = scripted([u({ identity })]);
      await runTurn(createSession(), "my details", llm);
      return prompts[0].match(/Say that the details provided[^\n]*/)?.[0];
    };
    const wrongName = await ask({ name: "Margaret Chan", policy_number: "POL-9921", dob: "1985-03-15" });
    const wrongDob = await ask({ name: "Margaret Chen", policy_number: "POL-9921", dob: "1990-01-01" });
    expect(wrongName).toBeTruthy();
    expect(wrongName).toBe(wrongDob);
  });

  it("rolls state back if the model call fails mid-turn", async () => {
    const s = createSession();
    const llm: Llm = {
      understand: async () => MARGARET_TURN_1,
      respond: async () => {
        throw new Error("API down");
      },
      summarize: async () => {
        throw new Error("unused");
      },
    };
    await expect(runTurn(s, "turn 1", llm)).rejects.toThrow("API down");
    expect(s.phase).toBe("VERIFY_ID");
    expect(s.memory.verified_party_id).toBeUndefined();
    expect(s.transcript).toHaveLength(0);
  });
});
