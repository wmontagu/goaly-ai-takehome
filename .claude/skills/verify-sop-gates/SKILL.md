---
name: verify-sop-gates
description: Check that the SOP's safety invariants still hold after any change to lib/sop, lib/tools.ts, lib/llm, or the prompts. Use before committing changes to the engine, gates, filter, phases, or tool allowlist.
---

# verify-sop-gates

The invariants this project exists to enforce (SPEC §7). Check each one by
reading the code, not by assuming:

1. **Transitions are code-only.** `transition()` in lib/sop/state-machine.ts
   is called only from lib/sop/engine.ts. No LLM output field names a phase.
2. **No claim data before verification.** `visibleData()` for VERIFY_ID
   returns field names/counts only. `TOOL_ALLOWLIST.VERIFY_ID` contains no
   claim tool. Nothing in lib/llm/understand.ts reads fixtures.
3. **The output filter runs on every pre-verification reply** in
   `runTurn` before the reply is pushed to the transcript or returned.
4. **Gates decide from memory + fixtures only.** No gate reads LLM prose;
   `passed` never comes from an Understanding field alone.
5. **Email only on an explicit yes, to the email on file.**
   `sendEmailSummary` checks `email.decision === "send"` and uses the
   policyholder record's email.
6. **Every loop has a bounded exit** (sop.config `GATES`).

Then run `npm test` (the engine tests use a scripted LLM and cover 2, 3,
and 5 end to end) and, with a key, `npm run eval`.
