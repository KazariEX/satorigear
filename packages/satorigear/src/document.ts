import type { Root } from "mdast";
import { createMarkdownBlockTokenizer } from "./grammar-blocks.ts";
import {
  markdownFragmentsToMdast,
  markdownSyntaxBlockToMdastFragment,
  type MdastBlockFragment,
} from "./mdast.ts";
import { createMarkdownCompositeDocument, markdownBlockParser } from "./parser.ts";
import type { EmittedDocument } from "./emitted-parser.ts";

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

function changedRangeOf(edits: readonly TextEdit[]): MarkdownUpdate["changedRange"] {
  if (edits.length === 0) {
    return { start: 0, end: 0 };
  }

  let delta = 0;
  let changedEnd = edits[0].start;
  for (const edit of edits) {
    changedEnd = edit.start + delta + edit.text.length;
    delta += edit.text.length - (edit.end - edit.start);
  }
  return { start: edits[0].start, end: changedEnd };
}

function sequentialEdits(edits: readonly TextEdit[]): TextEdit[] {
  let delta = 0;
  return edits.map((edit) => {
    const result = { start: edit.start + delta, end: edit.end + delta, text: edit.text };
    delta += edit.text.length - (edit.end - edit.start);
    return result;
  });
}

class StatefulMarkdownDocument implements MarkdownDocument {
  #blocks: EmittedDocument;
  #composite: ReturnType<typeof createMarkdownCompositeDocument>;
  #fragments = new Map<number, { fragment: MdastBlockFragment; source: string; version: string }>();
  #tokenizer: ReturnType<typeof createMarkdownBlockTokenizer>;

  constructor(source: string) {
    this.#tokenizer = createMarkdownBlockTokenizer(source);
    this.#blocks = markdownBlockParser.createDocument(source, this.#tokenizer.tokens);
    this.#composite = createMarkdownCompositeDocument(this.#blocks.tree(this.#tokenizer.tokens), source);
  }

  get source(): string {
    return this.#tokenizer.source;
  }

  edit(edits: readonly TextEdit[]): MarkdownUpdate {
    validateEdits(this.source, edits);
    if (edits.length === 0) {
      return { changedRange: { start: 0, end: 0 } };
    }
    const changedRange = changedRangeOf(edits);
    const update = this.#tokenizer.edit(edits);
    this.#blocks.edit(sequentialEdits(edits), update.change);
    this.#composite.update(this.#blocks.tree(this.#tokenizer.tokens), this.source);
    return { changedRange };
  }

  toMdast(): Root {
    const fragments = new Map<number, { fragment: MdastBlockFragment; source: string; version: string }>();
    const blocks = this.#composite.blocks().map((block) => {
      const previous = this.#fragments.get(block.id);
      const fragment = previous?.source === block.source && previous.version === block.version
        ? previous.fragment
        : markdownSyntaxBlockToMdastFragment(block.node, this.source, block.syntax);
      fragments.set(block.id, { fragment, source: block.source, version: block.version });
      return { fragment, offset: block.offset };
    });
    this.#fragments = fragments;
    return markdownFragmentsToMdast(blocks, this.source, (offset) => this.#tokenizer.point(offset));
  }
}

export function createMarkdownDocument(source: string): MarkdownDocument {
  return new StatefulMarkdownDocument(source);
}

export function markdownToMdast(source: string): Root {
  return createMarkdownDocument(source).toMdast();
}
