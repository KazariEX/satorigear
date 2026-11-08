import { strict as assert } from "node:assert";

export interface Observation {
  variant: "A" | "B";
  ns: number;
}

/** Paired log ratios cancel linear time drift within each ABBA or BAAB block. */
export function analyzeBlocks(runs: readonly Observation[]): {
  changePercent: number;
  ci95Percent: [number, number];
  blockChangesPercent: number[];
} {
  assert.ok(runs.length === 16 || runs.length === 32, "Use four or eight complete blocks");
  const ratios: number[] = [];
  for (let index = 0; index < runs.length; index += 4) {
    const block = runs.slice(index, index + 4);
    assert.equal(block.map((run) => run.variant).join(""), index / 4 % 2 ? "BAAB" : "ABBA");
    ratios.push(block.reduce((sum, run) => {
      assert.ok(Number.isFinite(run.ns) && run.ns > 0);
      return sum + Math.log(run.ns) * (run.variant === "B" ? 1 : -1);
    }, 0) / 2);
  }
  const mean = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
  const variance = ratios.reduce((sum, ratio) => sum + (ratio - mean) ** 2, 0) / (ratios.length - 1);
  const critical = ratios.length === 4 ? 3.182446305 : 2.364624252;
  const margin = critical * Math.sqrt(variance / ratios.length);
  return {
    changePercent: Math.expm1(mean) * 100,
    ci95Percent: [Math.expm1(mean - margin) * 100, Math.expm1(mean + margin) * 100],
    blockChangesPercent: ratios.map((ratio) => Math.expm1(ratio) * 100),
  };
}
