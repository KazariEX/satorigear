import type { Root } from "mdast";
import { createMarkdownBlockTokenizer } from "./grammar-blocks.ts";
import {
  type BlockFragment,
  materialize,
  type PlacedBlockFragment,
  projectBlock,
} from "./mdast.ts";
import { blockParser, createMarkdownSyntax } from "./parser.ts";
import type { EmittedParserDocument } from "./emitted-parser.ts";
import type { TextEdit } from "./text-edit.ts";

export interface EditResult {
  changedSpan: {
    end: number;
    start: number;
  };
}

export interface Document {
  readonly source: string;

  edit: (edits: readonly TextEdit[]) => EditResult;
  snapshot: () => Root;
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

function changedSpanOf(edits: readonly TextEdit[]): EditResult["changedSpan"] {
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

class DocumentImpl implements Document {
  #blocks: EmittedParserDocument;
  #syntax: ReturnType<typeof createMarkdownSyntax>;
  #fragments = new Map<number, { fragment: BlockFragment; version: number }>();
  #tokenizer: ReturnType<typeof createMarkdownBlockTokenizer>;

  constructor(source: string) {
    this.#tokenizer = createMarkdownBlockTokenizer(source);
    this.#blocks = blockParser.createDocument(source, this.#tokenizer.tokens);
    this.#syntax = createMarkdownSyntax(this.#blocks.view(this.#tokenizer.tokens), source);
  }

  get source(): string {
    return this.#tokenizer.source;
  }

  edit(edits: readonly TextEdit[]): EditResult {
    validateEdits(this.source, edits);
    if (edits.length === 0) {
      return { changedSpan: { start: 0, end: 0 } };
    }
    const changedSpan = changedSpanOf(edits);
    const update = this.#tokenizer.edit(edits);
    this.#blocks.edit(sequentialEdits(edits), update.change);
    this.#syntax.update(this.#blocks.view(this.#tokenizer.tokens), this.source, edits);
    return { changedSpan };
  }

  #projectBlocks(): PlacedBlockFragment[] {
    const fragments = new Map<number, { fragment: BlockFragment; version: number }>();
    const blocks = this.#syntax.blocks().map((block) => {
      const previous = this.#fragments.get(block.id);
      const fragment = previous?.version === block.version
        ? previous.fragment
        : projectBlock(block.id, block.offset, block.tokenBase, this.source, block.syntax);
      fragments.set(block.id, { fragment, version: block.version });
      return { fragment, offset: block.offset };
    });
    this.#fragments = fragments;
    return blocks;
  }

  snapshot(): Root {
    return materialize(this.#projectBlocks(), this.source.length, this.#tokenizer.locator());
  }
}

export function createDocument(source: string): Document {
  return new DocumentImpl(source);
}

export function parse(source: string): Root {
  return createDocument(source).snapshot();
}
