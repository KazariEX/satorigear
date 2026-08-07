import type { Root } from "mdast";
import type { CstNode } from "monogram/cst.ts";
import { markdownCstToMdast } from "./mdast.ts";
import { markdownPhasedParser } from "./parser.ts";

export interface TextEdit {
  end: number;
  start: number;
  text: string;
}

export interface MarkdownUpdate {
  changedRange: {
    end: number;
    start: number;
  };
}

export interface MarkdownDocument {
  readonly source: string;

  edit: (edits: readonly TextEdit[]) => MarkdownUpdate;
  toMdast: () => Root;
}

function validateEdits(source: string, edits: readonly TextEdit[]): void {
  let previousEnd = 0;
  for (const [index, edit] of edits.entries()) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)) {
      throw new TypeError("Markdown edit offsets must be integers");
    }
    if (edit.start < 0 || edit.end < edit.start || edit.end > source.length) {
      throw new RangeError(`Markdown edit [${edit.start}, ${edit.end}) is outside the document`);
    }
    if (index > 0 && edit.start < previousEnd) {
      throw new RangeError("Markdown edits must be sorted and must not overlap");
    }
    previousEnd = edit.end;
  }
}

function applyEdits(source: string, edits: readonly TextEdit[]): { changedRange: MarkdownUpdate["changedRange"]; source: string } {
  if (edits.length === 0) {
    return { source, changedRange: { start: 0, end: 0 } };
  }

  const parts: string[] = [];
  let cursor = 0;
  let delta = 0;
  let changedEnd = edits[0].start;
  for (const edit of edits) {
    parts.push(source.slice(cursor, edit.start), edit.text);
    cursor = edit.end;
    changedEnd = edit.start + delta + edit.text.length;
    delta += edit.text.length - (edit.end - edit.start);
  }
  parts.push(source.slice(cursor));
  return {
    source: parts.join(""),
    changedRange: { start: edits[0].start, end: changedEnd },
  };
}

class StatefulMarkdownDocument implements MarkdownDocument {
  #source: string;
  #tree: CstNode;

  constructor(source: string) {
    this.#source = source;
    this.#tree = markdownPhasedParser.parse(source);
  }

  get source(): string {
    return this.#source;
  }

  edit(edits: readonly TextEdit[]): MarkdownUpdate {
    validateEdits(this.#source, edits);
    const update = applyEdits(this.#source, edits);
    if (update.source !== this.#source) {
      this.#source = update.source;
      this.#tree = markdownPhasedParser.parse(update.source);
    }
    return { changedRange: update.changedRange };
  }

  toMdast(): Root {
    return markdownCstToMdast(this.#tree, this.#source);
  }
}

export function createMarkdownDocument(source: string): MarkdownDocument {
  return new StatefulMarkdownDocument(source);
}

export function markdownToMdast(source: string): Root {
  return createMarkdownDocument(source).toMdast();
}
