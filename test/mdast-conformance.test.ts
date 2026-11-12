import { isDeepStrictEqual } from "node:util";
import { tests } from "commonmark-spec";
import { fromMarkdown } from "mdast-util-from-markdown";
import { afterAll, describe, expect, it } from "vitest";
import { createParser } from "../packages/satorigear/src/index.ts";

interface Failure {
  section: string;
  markdown: string;
  expected: unknown;
  actual: unknown;
}

const parser = createParser();
const failures: Failure[] = [];
let exact = 0;

for (const test of tests) {
  const source = test.markdown.replace(/→/g, "\t");
  const expected = withoutPositions(fromMarkdown(source));
  const actual = withoutPositions(parser.parse(source));
  if (isDeepStrictEqual(actual, expected)) {
    exact++;
  }
  else if (failures.length < 30) {
    failures.push({ section: test.section, markdown: source, expected, actual });
  }
}

describe("mdast conformance", () => {
  it("matches mdast-util-from-markdown for the official corpus", () => {
    expect(exact).toBe(tests.length);
  });
});

afterAll(() => {
  console.log(`Conformance: ${exact}/${tests.length} exact semantic trees`);
  for (const failure of failures) {
    console.log(`  [${failure.section}] ${JSON.stringify(failure.markdown)}`);
    console.log(`    expected ${JSON.stringify(failure.expected)}`);
    console.log(`    actual   ${JSON.stringify(failure.actual)}`);
  }
});

function withoutPositions(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutPositions);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "position")
    .map(([key, child]) => [key, withoutPositions(child)]));
}
