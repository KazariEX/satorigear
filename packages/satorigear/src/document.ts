import type { Root, TopLevelContent } from "mdast";
import {
  type BlockRecord,
  type BlockScanChange,
  BlockScanner,
  type SourceChange,
} from "./block/scanner.ts";
import { type BlockBuildContext, buildBlockNode } from "./fragment/block.ts";
import { InlineRegionCursor, type ResolvedInlineRegion } from "./inline/region.ts";
import { resolveInlineRegions, SyntaxState } from "./syntax-state.ts";
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
  };
}

function buildTreeBlock(
  record: BlockRecord,
  regions: readonly ResolvedInlineRegion[],
  context: BlockBuildContext,
): TopLevelContent {
  context.cursor.reset(regions);
  return buildBlockNode<TopLevelContent>(record.tokenStart, context);
}

function shiftLocation(location: SourceLocation, shift: PositionShift): void {
  if (location.line === shift.columnLine) {
    location.column += shift.column;
  }
  location.offset += shift.offset;
  location.line += shift.line;
}

function shiftPositions(value: object, shift: PositionShift): void {
  const { position, children } = value as {
    children?: object[];
    position: { start: SourceLocation; end: SourceLocation };
  };
  shiftLocation(position.start, shift);
  shiftLocation(position.end, shift);
  if (children) {
    for (const child of children) {
      shiftPositions(child, shift);
    }
  }
}

export class DocumentImpl implements Document {
  #blockScanner: BlockScanner;
  #profile: SyntaxProfile;
  #source: string;
  #syntaxState: SyntaxState;
  #tree: Root = { type: "root", children: [] };

  constructor(source: string, profile: SyntaxProfile) {
    this.#profile = profile;
    this.#source = source;
    this.#blockScanner = new BlockScanner(profile.block);
    this.#blockScanner.scan(source);
    this.#syntaxState = new SyntaxState(profile.inline, this.#blockScanner);
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
    const records = this.#blockScanner.records;
    const regionsByBlock = this.#syntaxState.regionsByBlock();
    const locator = this.#blockScanner.locator();

    // Reuse one cursor across all rebuilt blocks; emitted nodes retain no build context.
    const context: BlockBuildContext = {
      inlineContext: void 0,
      locator,
      structure: this.#blockScanner,
      cursor: new InlineRegionCursor(),
      profile: this.#profile.inline,
      source: this.#source,
    };

    const root = this.#tree;
    const start = locator.locationAt(0);
    const children = root.children;
    const rebuildStart = change?.stableBlockCount ?? 0;
    const oldRebuildEnd = change?.oldRecordEnd ?? 0;
    const newRebuildEnd = change?.newRecordEnd ?? records.length;
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
      children[index] = buildTreeBlock(records[index], regionsByBlock[index], context);
    }
    for (let index = rebuildStart; index < newRebuildEnd; index++) {
      children[index] = buildTreeBlock(records[index], regionsByBlock[index], context);
    }

    // 3. Reconcile the retained suffix. Stable roots share one position shift;
    // once positions converge, skip directly to any remaining definition-invalidated blocks.
    let positionShift: PositionShift | undefined;
    for (let index = newRebuildEnd; index < records.length; index++) {
      if (invalidatedBlocks[invalidatedIndex] === index) {
        children[index] = buildTreeBlock(records[index], regionsByBlock[index], context);
        invalidatedIndex++;
        continue;
      }
      if (!positionShift) {
        const previousStart = children[index].position!.start as SourceLocation;
        const nextStart = locator.locationAt(previousStart.offset + suffixOffsetDelta);
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
      children[index] = buildTreeBlock(records[index], regionsByBlock[index], context);
    }
    root.position = {
      start,
      end: locator.locationAt(this.#source.length),
    };
  }

  static parse(
    source: string,
    profile: SyntaxProfile,
    blockScanner: BlockScanner,
  ): Root {
    blockScanner.scan(source);

    const regions = resolveInlineRegions(source, profile.inline, blockScanner);
    const locator = blockScanner.locator();
    const context: BlockBuildContext = {
      inlineContext: void 0,
      locator,
      structure: blockScanner,
      cursor: new InlineRegionCursor(regions),
      profile: profile.inline,
      source,
    };

    const start = locator.locationAt(0);
    const children = blockScanner.records.map((block) => (
      buildBlockNode<TopLevelContent>(block.tokenStart, context)
    ));

    return {
      type: "root",
      children,
      position: { start, end: locator.locationAt(source.length) },
    };
  }
}
