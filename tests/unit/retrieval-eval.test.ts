import { describe, expect, it } from "vitest";
import { retrieve } from "@/lib/domain/retrieval";
import { EVAL_SET, HELD_OUT, type EvalCase } from "./retrieval-eval.data";

/** Rank (1-based) of the first acceptable chunk in the top 5, or 0 if none. */
function rank(c: EvalCase): number {
  return retrieve(c.q, c.party, 5).findIndex((r) => c.want.includes(r.id)) + 1;
}

function score(set: EvalCase[]) {
  const ranks = set.map(rank);
  const pct = (n: number) => Math.round((n / set.length) * 100);
  return {
    hit1: pct(ranks.filter((r) => r === 1).length),
    hit3: pct(ranks.filter((r) => r >= 1 && r <= 3).length),
    // The reply model receives the top 5, so this is "did the answer reach it".
    recall5: pct(ranks.filter((r) => r >= 1).length),
  };
}

describe("retrieval quality", () => {
  it("tuning set: right record first for nearly all, always in the top 3", () => {
    const s = score(EVAL_SET);
    console.log(`tuning set   hit@1 ${s.hit1}%  hit@3 ${s.hit3}%  recall@5 ${s.recall5}%`);
    expect(s.hit3).toBe(100);
    expect(s.hit1).toBeGreaterThanOrEqual(95);
  });

  it("held-out set (never tuned on): the answer reaches the model for nearly all", () => {
    const s = score(HELD_OUT);
    console.log(`held-out set hit@1 ${s.hit1}%  hit@3 ${s.hit3}%  recall@5 ${s.recall5}%`);
    // Floors at today's measured level, so a change that makes retrieval worse fails.
    expect(s.recall5).toBeGreaterThanOrEqual(95);
    expect(s.hit3).toBeGreaterThanOrEqual(85);
  });
});
