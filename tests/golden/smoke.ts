/**
 * One real-model turn of the canonical Margaret test case. Usage:
 *   ANTHROPIC_API_KEY=... npx tsx tests/golden/smoke.ts
 */
import { claudeLlm } from "@/lib/llm";
import { runTurn } from "@/lib/sop/engine";
import { createSession } from "@/lib/sop/session";

async function main() {
  const s = createSession();
  const llm = claudeLlm();
  const t0 = Date.now();
  const { reply } = await runTurn(
    s,
    "I'm the policyholder. My name is Margaret Chen, policy POL-9921. I'm calling about my denied healthcare claim from January. DOB is 1985-03-15, SSN last four is 4472.",
    llm,
  );
  console.log(`[${Date.now() - t0}ms] phase=${s.phase} case=${s.memory.selected_case_id}`);
  for (const e of s.trace) console.log(`  ${e.kind}: ${e.summary}`);
  console.log(`\nAGENT: ${reply}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
