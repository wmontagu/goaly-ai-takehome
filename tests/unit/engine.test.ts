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
