import type { Node, Root, TopLevelContent } from "mdast";
import { type BlockScanChange, BlockScanner, type SourceChange } from "./block/scanner.ts";
import { BlockStructure } from "./block/structure.ts";
import { type BlockBuildContext, buildBlockNode } from "./fragment/block.ts";
import { InlineRegionCursor } from "./inline/region.ts";
import { emptyArray } from "./primitives.ts";
import {
  resolveInlineRegions,
  type SyntaxBlock,
  SyntaxState,
} from "./syntax-state.ts";
import type { SpannedValue } from "./fragment/node.ts";
import type { SyntaxProfile } from "./profile/types.ts";
import type { SourceLocation, SourceSpan } from "./source-view.ts";

export interface TextEdit extends SourceSpan {
  text: string;
}

export interface EditResult {
  changedSpan: SourceSpan;
}

export interface Document {
  readonly source: string;
  /** The document-owned tree. Edits mutate this value; callers must not morph it. */
  readonly tree: Root;

  edit: (edits: readonly TextEdit[]) => EditResult;
}

interface PositionShift extends SourceLocation {
  columnLine: number;
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

function materializeNode(
  value: SpannedValue,
  locate: (offset: number) => SourceLocation,
): void {
  const { position, children = emptyArray } = value;
  const result = position as unknown as NonNullable<Node["position"]>;
  result.start = locate(position.start);
  for (const child of children) {
    materializeNode(child, locate);
  }
  result.end = locate(position.end);
}

function buildTreeBlock(
  block: SyntaxBlock,
  context: BlockBuildContext,
  locate: (offset: number) => SourceLocation,
): TopLevelContent {
  context.cursor.reset(block.regions);
  const node = buildBlockNode<TopLevelContent>(block.record.tokenStart, context);
  materializeNode(node, locate);
  return node as unknown as TopLevelContent;
}

function shiftLocation(location: SourceLocation, shift: PositionShift): void {
  if (location.line === shift.columnLine) {
    location.column += shift.column;
  }
  location.offset += shift.offset;
  location.line += shift.line;
}

function shiftPositions(value: object, shift: PositionShift): void {
  const { position, children = emptyArray } = value as {
    children?: object[];
    position: { start: SourceLocation; end: SourceLocation };
  };
  shiftLocation(position.start, shift);
  shiftLocation(position.end, shift);
  for (const child of children) {
    shiftPositions(child, shift);
  }
}

export class DocumentImpl implements Document {
  #blockStructure: BlockStructure;
  #blockScanner: BlockScanner;
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
    this.#syntaxState = new SyntaxState(profile.inline, this.#blockStructure);
    this.#updateTree(this.#syntaxState.update(source));
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
    const invalidatedBlocks = this.#syntaxState.update(change.nextSource, blockChange);
    this.#source = change.nextSource;
    this.#updateTree(invalidatedBlocks, blockChange);

    return { changedSpan: change.changedSpan };
  }

  #updateTree(invalidatedBlocks: readonly number[], change?: BlockScanChange): void {
    const blocks = this.#syntaxState.blocks();

    // Reuse one cursor across all rebuilt blocks; emitted nodes retain no build context.
    const context: BlockBuildContext = {
      structure: this.#blockStructure,
      cursor: new InlineRegionCursor(),
      profile: this.#profile.inline,
      source: this.#source,
    };

    const locate = this.#blockScanner.locator();
    const root = this.#tree;
    const start = locate(0);
    const children = root.children;
    const rebuildStart = change?.stableBlockCount ?? 0;
    const oldRebuildEnd = change?.oldRecordEnd ?? 0;
    const newRebuildEnd = change?.newRecordEnd ?? blocks.length;
    const blockDelta = newRebuildEnd - oldRebuildEnd;
    const suffixOffsetDelta = change?.offsetDelta ?? 0;

    // 1. Align materialized children with the scanner's record replacement by moving the
    // retained suffix once; rebuilt nodes fill the replacement slots below.
    if (blockDelta > 0 && children.length > 0) {
      const previousLength = children.length;
      children.length += blockDelta;
      children.copyWithin(newRebuildEnd, oldRebuildEnd, previousLength);
    }
    else if (blockDelta > 0) {
      children.length = blockDelta;
    }
    else if (blockDelta < 0) {
      children.copyWithin(newRebuildEnd, oldRebuildEnd);
      children.length += blockDelta;
    }

    // 2. Rebuild sparse definition invalidations before the continuous scanner damage range,
    // then replace every child within that range.
    let invalidatedIndex = 0;
    while (
      invalidatedIndex < invalidatedBlocks.length &&
      invalidatedBlocks[invalidatedIndex] < rebuildStart
    ) {
      const index = invalidatedBlocks[invalidatedIndex++];
      children[index] = buildTreeBlock(blocks[index], context, locate);
    }
    for (let index = rebuildStart; index < newRebuildEnd; index++) {
      children[index] = buildTreeBlock(blocks[index], context, locate);
    }

    // 3. Reconcile the retained suffix. Stable roots share one position shift;
    // once positions converge, skip directly to any remaining definition-invalidated blocks.
    let positionShift: PositionShift | undefined;
    for (let index = newRebuildEnd; index < blocks.length; index++) {
      if (invalidatedBlocks[invalidatedIndex] === index) {
        children[index] = buildTreeBlock(blocks[index], context, locate);
        invalidatedIndex++;
        continue;
      }
      if (!positionShift) {
        const previousStart = children[index].position!.start as SourceLocation;
        const nextStart = locate(previousStart.offset + suffixOffsetDelta);
        if (
          nextStart.offset === previousStart.offset &&
          nextStart.line === previousStart.line &&
          nextStart.column === previousStart.column
        ) {
          break;
        }
        positionShift = {
          offset: nextStart.offset - previousStart.offset,
          line: nextStart.line - previousStart.line,
          columnLine: previousStart.line,
          column: nextStart.column - previousStart.column,
        };
      }
      shiftPositions(children[index], positionShift);
    }
    while (invalidatedIndex < invalidatedBlocks.length) {
      const index = invalidatedBlocks[invalidatedIndex++];
      children[index] = buildTreeBlock(blocks[index], context, locate);
    }
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

    const locate = blockScanner.locator();
    const start = locate(0);
    const children = blockScanner.records.map((block) => {
      const node = buildBlockNode<TopLevelContent>(block.tokenStart, context);
      materializeNode(node, locate);
      return node as unknown as TopLevelContent;
    });

    return {
      type: "root",
      children,
      position: { start, end: locate(source.length) },
    };
  }
}
