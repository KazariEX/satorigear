import { tests } from "commonmark-spec";
import { describe, expect, it } from "vitest";
import type { CstLeaf, CstNode } from "monogram/cst.ts";
import type { SourceRange } from "monogram/source-view.ts";
import { markdownPhasedParser } from "./support/markdown-phased-parser.ts";

interface SpecCase { markdown: string }
interface Span { offset: number; end: number; ranges?: readonly SourceRange[] }

const cases = tests as SpecCase[];

function physicalRanges(span: Span): readonly SourceRange[] {
  return span.ranges?.length ? span.ranges : [{ offset: span.offset, end: span.end }];
}

function leaves(node: CstNode): CstLeaf[] {
  return node.children.flatMap((child) => {
    return "tokenType" in child ? child : leaves(child);
  });
}

function uncoveredPayload(node: CstNode, source: string): string {
  const covered = leaves(node)
    .flatMap(physicalRanges)
    .filter((range) => range.end > range.offset)
    .sort((left, right) => left.offset - right.offset);
  let result = "";
  for (const parent of physicalRanges(node)) {
    let offset = parent.offset;
    for (const range of covered) {
      if (range.end <= parent.offset || range.offset >= parent.end) {
        continue;
      }
      const start = Math.max(parent.offset, range.offset);
      const end = Math.min(parent.end, range.end);
      if (start > offset) {
        result += source.slice(offset, start);
      }
      offset = Math.max(offset, end);
    }
    if (offset < parent.end) {
      result += source.slice(offset, parent.end);
    }
  }
  return result;
}

function validateSpan(span: Span, source: string): void {
  expect(Number.isInteger(span.offset)).toBe(true);
  expect(Number.isInteger(span.end)).toBe(true);
  expect(span.offset).toBeGreaterThanOrEqual(0);
  expect(span.end).toBeGreaterThanOrEqual(span.offset);
  expect(span.end).toBeLessThanOrEqual(source.length);

  const ranges = physicalRanges(span);
  expect(ranges.length).toBeGreaterThan(0);
  expect(ranges[0].offset).toBe(span.offset);
  expect(ranges.at(-1)!.end).toBe(span.end);
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index];
    expect(range.offset).toBeGreaterThanOrEqual(0);
    expect(range.end).toBeGreaterThanOrEqual(range.offset);
    expect(range.end).toBeLessThanOrEqual(source.length);
    if (index > 0) {
      expect(range.offset).toBeGreaterThanOrEqual(ranges[index - 1].end);
    }
  }
}

function rangeIsCovered(range: SourceRange, parents: readonly SourceRange[]): boolean {
  return parents.some((parent) => range.offset >= parent.offset && range.end <= parent.end);
}

function validateNode(node: CstNode, source: string, parent?: CstNode, path = node.rule): void {
  validateSpan(node, source);
  const nodeRanges = physicalRanges(node);
  if (parent) {
    const parentRanges = physicalRanges(parent);
    for (const range of nodeRanges) {
      expect(rangeIsCovered(range, parentRanges)).toBe(true);
    }
  }

  let previousStart = -1;
  for (const child of node.children) {
    validateSpan(child, source);
    const childRanges = physicalRanges(child);
    for (const range of childRanges) {
      if (!rangeIsCovered(range, nodeRanges)) {
        throw new Error(`Child range ${JSON.stringify(range)} escapes ${path} ${JSON.stringify(nodeRanges)}`);
      }
    }
    if (childRanges[0].offset < previousStart) {
      throw new Error(`Out-of-order child range in ${path}: ${childRanges[0].offset} < ${previousStart}`);
    }
    previousStart = childRanges[0].offset;
    if (!("tokenType" in child)) {
      validateNode(child, source, node, `${path}/${child.rule}`);
    }
  }

  if (node.rule === "InlineLines") {
    const uncovered = uncoveredPayload(node, source);
    if (!/^[ \t\r\n]*$/.test(uncovered)) {
      throw new Error(`Uncovered inline payload in ${path}: ${JSON.stringify(uncovered)}`);
    }
  }
}

describe("block-first markdown source-range gate", () => {
  it("preserves lossless inline payload ranges for the official corpus", () => {
    for (const test of cases) {
      const source = test.markdown.replace(/→/g, "\t");
      const tree = markdownPhasedParser.parse(source);
      try {
        validateNode(tree, source);
      }
      catch (error) {
        throw new Error(`Source-range failure for ${JSON.stringify(source)}`, { cause: error });
      }
    }
  });
});
