import type { Root, TopLevelContent } from "mdast";
import { BlockScanner } from "./block/scanner.ts";
import { BlockStructure } from "./block/structure.ts";
import { type BlockBuildContext, buildBlockNode } from "./fragment/block.ts";
import { materialize, materializeNode, relocateStableNode } from "./fragment/output/materialize.ts";
import { InlineRegionCursor } from "./inline/region.ts";
import { resolveInlineRegions, type SyntaxBlock, SyntaxState } from "./syntax-state.ts";
import type { SpannedNode } from "./fragment/node.ts";
import type { SyntaxProfile } from "./profile/types.ts";
import type { SourceChange, SourceSpan, TextEdit } from "./source-view.ts";

export interface EditResult {
  changedSpan: SourceSpan;
}

export interface Document {
  readonly source: string;
  /** The document-owned tree. Edits mutate this value; callers must not morph it. */
  readonly tree: Root;

  edit: (edits: readonly TextEdit[]) => EditResult;
}

interface MaterializedBlock {
  node: TopLevelContent;
  offset: number;
}

// Edit coordinates refer to the old source, so application and damage calculation share one forward pass.
function applyEdits(source: string, edits: readonly TextEdit[]): SourceChange {
  const parts: string[] = [];
  let cursor = 0;
  let delta = 0;
  for (const edit of edits) {
    if (edit.start < 0 || edit.end < edit.start || edit.end > source.length) {
      throw new RangeError(`Markdown edit [${edit.start}, ${edit.end}) is outside the document`);
    }
    if (edit.start < cursor) {
      throw new RangeError("Markdown edits must be sorted and must not overlap");
    }
    parts.push(source.slice(cursor, edit.start), edit.text);
    delta += edit.text.length - (edit.end - edit.start);
    cursor = edit.end;
  }
  parts.push(source.slice(cursor));
  return {
    changedSpan: { start: edits[0].start, end: cursor + delta },
    nextSource: parts.join(""),
    offsetDelta: delta,
    previousSource: source,
  };
}

export class DocumentImpl implements Document {
  #blockStructure: BlockStructure;
  #blockScanner: BlockScanner;
  #blocks = new WeakMap<SyntaxBlock, MaterializedBlock>();
  #profile: SyntaxProfile;
  #source: string;
  #syntaxState: SyntaxState;
  #tree: Root = { type: "root", children: [] };

  constructor(source: string, profile: SyntaxProfile) {
    this.#profile = profile;
    this.#source = source;
    this.#blockScanner = new BlockScanner(profile.block);
    this.#blockStructure = new BlockStructure(profile.block.schema, this.#blockScanner);
    this.#blockScanner.scan(source);
    this.#syntaxState = new SyntaxState(source, profile.inline, this.#blockStructure);
    this.#updateTree();
  }

  get source(): string {
    return this.#source;
  }

  get tree(): Root {
    return this.#tree;
  }

  edit(edits: readonly TextEdit[]): EditResult {
    if (edits.length === 0) {
      return { changedSpan: { start: 0, end: 0 } };
    }
    const change = applyEdits(this.source, edits);

    const blockChange = this.#blockScanner.edit(change);
    this.#source = change.nextSource;
    this.#syntaxState.update(this.#source, blockChange, change.offsetDelta);
    this.#updateTree(blockChange.stableBlockCount);

    return { changedSpan: change.changedSpan };
  }

  #updateTree(stableBlockCount = 0): void {
    const blocks = this.#syntaxState.blocks();
    const previousBlocks = this.#blocks;
    const cursor = new InlineRegionCursor();

    // Changed blocks share one build workspace; no syntax reference escapes the resulting nodes.
    const context: BlockBuildContext = {
      structure: this.#blockStructure,
      cursor,
      profile: this.#profile.inline,
      source: this.#source,
    };

    const locate = this.#blockScanner.locator(this.#source);
    const root = this.#tree;
    const start = locate(0);
    const children = root.children;
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      const offset = this.#blockStructure.tokens.start(block.record.tokenStart);
      let materialized = previousBlocks.get(block);
      if (materialized) {
        // The scanner-stable prefix retained both source geometry and block identity.
        if (index >= stableBlockCount) {
          relocateStableNode(materialized.node, offset - materialized.offset, locate);
        }
        materialized.offset = offset;
      }
      else {
        cursor.reset(block.regions);
        const node: SpannedNode<TopLevelContent> = buildBlockNode(block.record.tokenStart, context);
        materializeNode(node, locate);
        materialized = {
          node: node as unknown as TopLevelContent,
          offset,
        };
        previousBlocks.set(block, materialized);
      }
      children[index] = materialized.node;
    }
    children.length = blocks.length;
    root.position = {
      start,
      end: locate(this.#source.length),
    };
  }

  static parse(
    source: string,
    profile: SyntaxProfile,
    blockScanner: BlockScanner,
    blockStructure: BlockStructure,
  ): Root {
    blockScanner.scan(source);

    const regions = resolveInlineRegions(source, profile.inline, blockStructure);
    const context: BlockBuildContext = {
      structure: blockStructure,
      cursor: new InlineRegionCursor(regions),
      profile: profile.inline,
      source,
    };

    return materialize(
      blockStructure.records.map((block) => buildBlockNode(block.tokenStart, context)),
      source.length,
      blockScanner.locator(source),
    );
  }
}
