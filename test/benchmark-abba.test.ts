import { describe, expect, it } from "vitest";
import { analyzeBlocks, type Observation } from "./benchmark/helpers/abba.ts";

function observations(ratio: number, drift = 0, blocks = 4): Observation[] {
  return Array.from({ length: blocks }, (_, block) => {
    const order = block % 2 ? "BAAB" : "ABBA";
    return [...order].map((variant, index) => ({
      variant: variant as "A" | "B",
      ns: 1000 * Math.exp((block * 4 + index) * drift) * (variant === "B" ? ratio : 1),
    }));
  }).flat();
}

describe("abba analysis", () => {
  it("recovers a known speed change in the presence of monotonic drift", () => {
    for (const blocks of [4, 8]) {
      const result = analyzeBlocks(observations(0.95, 0.03, blocks));
      expect(result.changePercent).toBeCloseTo(-5, 10);
      expect(result.ci95Percent[0]).toBeCloseTo(-5, 10);
      expect(result.ci95Percent[1]).toBeCloseTo(-5, 10);
    }
  });

  it("reports no difference for A/A and retains an outlying block", () => {
    expect(analyzeBlocks(observations(1, -0.03)).changePercent).toBeCloseTo(0, 10);
    const runs = observations(1);
    runs[1].ns *= 4;
    const result = analyzeBlocks(runs);
    expect(result.blockChangesPercent[0]).toBeCloseTo(100, 10);
    expect(result.blockChangesPercent).toHaveLength(4);
    expect(result.changePercent).toBeGreaterThan(0);
  });

  it("rejects incomplete blocks, invalid times, and an incorrect observation order", () => {
    expect(() => analyzeBlocks(observations(1).slice(1))).toThrow();
    const invalidTime = observations(1);
    invalidTime[0].ns = NaN;
    expect(() => analyzeBlocks(invalidTime)).toThrow();
    const invalidOrder = observations(1);
    invalidOrder[0].variant = "B";
    expect(() => analyzeBlocks(invalidOrder)).toThrow();
  });
});
