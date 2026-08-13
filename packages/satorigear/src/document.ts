import type { Root } from "mdast";
import { BlockArena, type BlockHandle } from "./block/arena.ts";
import { BlockScanner } from "./block/scanner.ts";
import { type BlockBuildContext, buildBlockNode } from "./fragment/block.ts";
import { materialize, snapshot } from "./fragment/output/materialize.ts";
import { type InlineRegion, InlineRegionCursor } from "./inline/region.ts";
import { createInlineRegions, SyntaxState } from "./syntax-state.ts";
import type { BlockFragment } from "./fragment/node.ts";
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
  #fragments: BlockFragment[] = [];
  #previousFragments?: Map<BlockHandle, BlockFragment>;
  #profile: SyntaxProfile;
  #syntaxState: SyntaxState;

  constructor(source: string, profile: SyntaxProfile) {
    this.#profile = profile;
    this.#blockScanner = new BlockScanner(profile.block);
    this.#blockArena = new BlockArena(profile.block.schema);
    this.#blockScanner.scan(source);
    this.#blockArena.build(this.#blockScanner.tokens);
    this.#syntaxState = new SyntaxState(source, profile, this.#blockArena.view());
  }

  get source(): string {
    return this.#blockScanner.source;
  }

  edit(edits: readonly TextEdit[]): EditResult {
    if (edits.length === 0) {
      return { changedSpan: { start: 0, end: 0 } };
    }
    const applied = applyEdits(this.source, edits);

    if (this.#fragments.length > 0 && this.#previousFragments === void 0) {
      // Preserve fragment identity before the syntax update changes block order and offsets.
      const blocks = this.#syntaxState.blocks();
      const fragments = new Map<BlockHandle, BlockFragment>();
      for (let index = 0; index < blocks.length; index++) {
        fragments.set(blocks[index].handle, this.#fragments[index]);
      }
      this.#previousFragments = fragments;
    }

    const { stableBlockCount, tokenChange } = this.#blockScanner.edit(
      applied.source,
      applied.changedSpan,
      applied.oldChangedEnd,
    );
    const arenaChange = this.#blockArena.update(this.#blockScanner.tokens, tokenChange);
    this.#syntaxState.update(this.source, this.#blockArena.view(), arenaChange, stableBlockCount);

    return { changedSpan: applied.changedSpan };
  }

  snapshot(): Root {
    return snapshot(this.#buildBlockFragments(), this.source.length, this.#blockScanner.locator());
  }

  #buildBlockFragments(): BlockFragment[] {
    const previousFragments = this.#previousFragments;
    if (this.#fragments.length > 0 && previousFragments === void 0) {
      return this.#fragments;
    }

    const blocks = this.#syntaxState.blocks();
    const changedBlocks = previousFragments === void 0
      ? blocks
      : blocks.filter((block) => previousFragments.get(block.handle)?.version !== block.version);

    const regions: InlineRegion[] = [];
    for (const block of changedBlocks) {
      for (const region of block.regions) {
        regions.push(region);
      }
    }
    // Changed regions share one build workspace; no arena reference escapes the resulting fragments.
    const context: BlockBuildContext = {
      inline: new InlineRegionCursor(regions),
      profile: this.#profile,
      source: this.source,
      view: this.#syntaxState.blockView(),
    };

    const nextFragments = blocks.map((block) => {
      const previous = previousFragments?.get(block.handle);
      const fragment = previous?.version === block.version
        ? previous
        : {
          node: buildBlockNode(block.handle.id, block.offset, block.tokenBase, context),
          offset: block.offset,
          origin: block.offset,
          version: block.version,
        };
      fragment.offset = block.offset;
      return fragment;
    });

    this.#previousFragments = void 0;
    this.#fragments = nextFragments;
    return nextFragments;
  }

  static parse(
    source: string,
    profile: SyntaxProfile,
    blockScanner: BlockScanner,
    blockArena: BlockArena,
  ): Root {
    blockScanner.scan(source);
    blockArena.build(blockScanner.tokens);

    const view = blockArena.view();
    const regions = createInlineRegions(source, profile, view);
    const context: BlockBuildContext = {
      inline: new InlineRegionCursor(regions),
      profile,
      source,
      view,
    };

    return materialize(
      view.blocks.map((block) => buildBlockNode(
        block.id,
        view.tokens.start(block.tokenStart),
        block.tokenStart,
        context,
      )),
      source.length,
      blockScanner.locator(),
    );
  }
}
