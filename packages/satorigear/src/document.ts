import type { Root } from "mdast";
import { BlockScanner } from "./block/scanner.ts";
import { type BlockFragment, type BlockProjectionContext, materialize, projectBlock } from "./mdast.ts";
import { SyntaxState } from "./syntax-state.ts";
import type { BlockSyntaxDocument, BlockSyntaxParser } from "./block/syntax.ts";
import type { InlineSyntaxArena } from "./inline/syntax.ts";
import type { SyntaxProfile } from "./profile/types.ts";
import type { TextEdit } from "./source-view.ts";

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

export class DocumentImpl implements Document {
  #blockScanner: BlockScanner;
  #blockSyntax: BlockSyntaxDocument;
  #fragmentsByBlockId?: Map<number, BlockFragment>;
  #fragments: BlockFragment[] = [];
  #profile: SyntaxProfile;
  #syntaxState: SyntaxState;

  constructor(
    source: string,
    profile: SyntaxProfile,
    blockParser: BlockSyntaxParser,
    inlineArena: InlineSyntaxArena,
  ) {
    this.#profile = profile;
    this.#blockScanner = new BlockScanner(source, profile);
    this.#blockSyntax = blockParser.parse(this.#blockScanner.tokens);
    this.#syntaxState = new SyntaxState(
      source,
      this.#blockSyntax.view(),
      profile,
      inlineArena,
    );
  }

  get source(): string {
    return this.#blockScanner.source;
  }

  edit(edits: readonly TextEdit[]): EditResult {
    validateEdits(this.source, edits);
    if (edits.length === 0) {
      return { changedSpan: { start: 0, end: 0 } };
    }

    if (this.#fragments.length > 0 && this.#fragmentsByBlockId === void 0) {
      // Preserve fragment identity before the syntax update changes block order and offsets.
      const blocks = this.#syntaxState.blocks();
      const fragmentsByBlockId = new Map<number, BlockFragment>();
      for (let index = 0; index < blocks.length; index++) {
        fragmentsByBlockId.set(blocks[index].id, this.#fragments[index]);
      }
      this.#fragmentsByBlockId = fragmentsByBlockId;
    }

    const blockEdit = this.#blockScanner.edit(edits);
    this.#blockSyntax.update(this.#blockScanner.tokens, blockEdit.change);
    this.#syntaxState.update(this.source, this.#blockSyntax.view());

    return {
      changedSpan: changedSpanOf(edits),
    };
  }

  #projectBlocks(): BlockFragment[] {
    const previousFragments = this.#fragmentsByBlockId;
    if (this.#fragments.length > 0 && previousFragments === void 0) {
      return this.#fragments;
    }

    const blocks = this.#syntaxState.blocks();
    const changedBlocks = previousFragments === void 0
      ? blocks
      : blocks.filter((block) => previousFragments.get(block.id)?.version !== block.version);
    const context: BlockProjectionContext = {
      profile: this.#profile,
      source: this.source,
      syntaxState: this.#syntaxState,
      view: this.#syntaxState.blockView(),
    };
    // Changed regions share one projection workspace; no arena reference escapes the resulting fragments.
    this.#syntaxState.prepareInline(changedBlocks);

    const nextFragments = blocks.map((block) => {
      const previous = previousFragments?.get(block.id);
      const fragment = previous?.version === block.version ? previous : projectBlock(block, context);
      fragment.offset = block.offset;
      return fragment;
    });

    this.#fragmentsByBlockId = void 0;
    this.#fragments = nextFragments;
    return nextFragments;
  }

  snapshot(): Root {
    return materialize(this.#projectBlocks(), this.source.length, this.#blockScanner.locator());
  }
}
