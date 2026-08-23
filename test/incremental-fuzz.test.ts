import { isDeepStrictEqual } from "node:util";
import { tests } from "commonmark-spec";
import { describe, expect, it } from "vitest";
import { createParser, type TextEdit } from "../packages/satorigear/src/index.ts";

const parser = createParser();

function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function applyEdits(source: string, edits: readonly TextEdit[]): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const edit of edits) {
    parts.push(source.slice(cursor, edit.start), edit.text);
    cursor = edit.end;
  }
  parts.push(source.slice(cursor));
  return parts.join("");
}

function nextEdits(source: string, choose: () => number, step: number): TextEdit[] {
  const replacements = ["", "x", "*", "`", "~", "<", ">", "](", ")", "&", "\\", "\n", "\r\n", "✨", "> ", "[a]"];
  if (step % 3 === 2) {
    const first = Math.floor(choose() * (source.length + 1));
    const second = first + Math.floor(choose() * (source.length - first + 1));
    return [
      { start: first, end: first, text: replacements[Math.floor(choose() * replacements.length)] },
      { start: second, end: second, text: replacements[Math.floor(choose() * replacements.length)] },
    ];
  }
  const start = Math.floor(choose() * (source.length + 1));
  const width = source.length - start;
  const end = start + Math.floor(choose() * (Math.min(4, width) + 1));
  return [{ start, end, text: replacements[Math.floor(choose() * replacements.length)] }];
}

describe("incremental differential fuzz", () => {
  it("matches fresh parsing after edits across the CommonMark corpus", { timeout: 30_000 }, () => {
    for (const [caseIndex, test] of tests.entries()) {
      let source = test.markdown.replace(/→/g, "\t");
      const document = parser.createDocument(source);
      const choose = random(caseIndex + 1);
      for (let step = 0; step < 8; step++) {
        const edits = nextEdits(source, choose, step);
        source = applyEdits(source, edits);
        document.edit(edits);
        const incremental = document.tree;
        const fresh = parser.parse(source);
        if (!isDeepStrictEqual(incremental, fresh)) {
          throw new Error(`Incremental mismatch after CommonMark example ${caseIndex + 1}, step ${step + 1}`);
        }
        expect(document.source).toBe(source);
      }
    }
  });
});
