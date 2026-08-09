import type { Root } from "mdast";
import { createBlockScanner, type MarkdownBlockScanner } from "./block-scanner.ts";
import {
  type BlockFragment,
  materialize,
  projectBlock,
} from "./mdast.ts";
import { blockSyntaxParser, createMarkdownSyntax, type MarkdownSyntax } from "./syntax.ts";
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
  #blockScanner: MarkdownBlockScanner;
  #blockSyntax: EmittedParserDocument;
  #syntax: MarkdownSyntax;
  #fragments = new Map<number, BlockFragment>();

  constructor(source: string) {
    this.#blockScanner = createBlockScanner(source);
    this.#blockSyntax = blockSyntaxParser.createDocument(source, this.#blockScanner.tokens);
    this.#syntax = createMarkdownSyntax(this.#blockSyntax.view(this.#blockScanner.tokens), source);
  }

  get source(): string {
    return this.#blockScanner.source;
  }

  edit(edits: readonly TextEdit[]): EditResult {
    validateEdits(this.source, edits);
    if (edits.length === 0) {
      return { changedSpan: { start: 0, end: 0 } };
    }
    const changedSpan = changedSpanOf(edits);
    const update = this.#blockScanner.edit(edits);
    this.#blockSyntax.edit(sequentialEdits(edits), update.change);
    this.#syntax.update(this.#blockSyntax.view(this.#blockScanner.tokens), this.source, edits);
    return { changedSpan };
  }

  #projectBlocks(): BlockFragment[] {
    const fragments = new Map<number, BlockFragment>();
    const syntaxBlocks = this.#syntax.blocks();
    const changed = syntaxBlocks.filter((block) => this.#fragments.get(block.id)?.version !== block.version);
    const forest = this.#syntax.openInlineForest(changed);
    try {
      // Consume scratch-backed roots before the later path can activate a region's document-owned arena.
      for (const block of forest.blocks) {
        fragments.set(block.id, projectBlock(
          block.id,
          block.offset,
          block.tokenBase,
          this.source,
          this.#syntax,
          block.version,
        ));
      }
    }
    finally {
      forest.close();
    }
    const blocks = syntaxBlocks.map((block) => {
      const previous = this.#fragments.get(block.id);
      const fragment = fragments.get(block.id) ?? (previous?.version === block.version
        ? previous
        : projectBlock(block.id, block.offset, block.tokenBase, this.source, this.#syntax, block.version));
      fragment.offset = block.offset;
      fragments.set(block.id, fragment);
      return fragment;
    });
    this.#fragments = fragments;
    return blocks;
  }

  snapshot(): Root {
    return materialize(this.#projectBlocks(), this.source.length, this.#blockScanner.locator());
  }
}

export function createDocument(source: string): Document {
  return new DocumentImpl(source);
}

export function parse(source: string): Root {
  return createDocument(source).snapshot();
}
