import type { Root } from "mdast";
import { BlockScanner } from "./block/scanner.ts";
import { type BlockFragment, type BlockProjectionContext, materialize, projectBlock } from "./mdast.ts";
import { SyntaxState } from "./syntax-state.ts";
import type { BlockArena } from "./block/arena.ts";
import type { InlineArena } from "./inline/arena.ts";
import type { SyntaxProfile } from "./profile/types.ts";
import type { SourceSpan, TextEdit } from "./source-view.ts";

export interface EditResult {
  changedSpan: SourceSpan;
}

export interface Document {
  readonly source: string;

  edit: (edits: readonly TextEdit[]) => EditResult;
  snapshot: () => Root;
}

interface AppliedEdits {
  changedSpan: SourceSpan;
  oldChangedEnd: number;
  source: string;
}

// Edit coordinates refer to the old source, so application and damage calculation share one forward pass.
function applyEdits(source: string, edits: readonly TextEdit[]): AppliedEdits {
  const parts: string[] = [];
  let cursor = 0;
  let delta = 0;
  let changedEnd = edits[0].start;
  for (const edit of edits) {
    if (edit.start < 0 || edit.end < edit.start || edit.end > source.length) {
      throw new RangeError(`Markdown edit [${edit.start}, ${edit.end}) is outside the document`);
    }
    if (edit.start < cursor) {
      throw new RangeError("Markdown edits must be sorted and must not overlap");
    }
    parts.push(source.slice(cursor, edit.start), edit.text);
    changedEnd = edit.start + delta + edit.text.length;
    delta += edit.text.length - (edit.end - edit.start);
    cursor = edit.end;
  }
  parts.push(source.slice(cursor));
  return {
    changedSpan: { start: edits[0].start, end: changedEnd },
    oldChangedEnd: cursor,
    source: parts.join(""),
  };
}

export class DocumentImpl implements Document {
  #blockArena: BlockArena;
  #blockScanner: BlockScanner;
  #fragmentsByBlockId?: Map<number, BlockFragment>;
  #fragments: BlockFragment[] = [];
  #profile: SyntaxProfile;
  #syntaxState: SyntaxState;

  constructor(
    source: string,
    profile: SyntaxProfile,
    blockArena: BlockArena,
    inlineArena: InlineArena,
  ) {
    this.#profile = profile;
    this.#blockScanner = new BlockScanner(source, profile.block);
    blockArena.build(this.#blockScanner.tokens);
    this.#blockArena = blockArena;
    this.#syntaxState = new SyntaxState(
      source,
      this.#blockArena.view(),
      profile,
      inlineArena,
    );
  }

  get source(): string {
    return this.#blockScanner.source;
  }

  edit(edits: readonly TextEdit[]): EditResult {
    if (edits.length === 0) {
      return { changedSpan: { start: 0, end: 0 } };
    }
    const applied = applyEdits(this.source, edits);

    if (this.#fragments.length > 0 && this.#fragmentsByBlockId === void 0) {
      // Preserve fragment identity before the syntax update changes block order and offsets.
      const blocks = this.#syntaxState.blocks();
      const fragmentsByBlockId = new Map<number, BlockFragment>();
      for (let index = 0; index < blocks.length; index++) {
        fragmentsByBlockId.set(blocks[index].id, this.#fragments[index]);
      }
      this.#fragmentsByBlockId = fragmentsByBlockId;
    }

    const tokenChange = this.#blockScanner.edit(applied.source, applied.changedSpan, applied.oldChangedEnd);
    this.#blockArena.update(this.#blockScanner.tokens, tokenChange);
    this.#syntaxState.update(this.source, this.#blockArena.view());

    return { changedSpan: applied.changedSpan };
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
