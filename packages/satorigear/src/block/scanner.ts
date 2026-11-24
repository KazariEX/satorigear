import type { Root, TopLevelContent } from "mdast";
import { BlockKind } from "../constants/block.ts";
import { Character } from "../constants/character.ts";
import { type BlockBuildContext, buildBlockNode } from "../fragment/block.ts";
import { BlockLines, lineIndentOffset } from "./lines.ts";
import { type BlockTokenChange, BlockTokenStream } from "./tokens.ts";
import type { InlineProfile } from "../inline/profile.ts";
import type { SourceLocator, SourceSpan } from "../source-view.ts";
import type { BlockProfile } from "./profile.ts";

export interface BlockScanChange {
  newRecordEnd: number;
  offsetDelta: number;
  oldRecordEnd: number;
  oldRecordStart: number;
  stableBlockCount: number;
  tokenChange: BlockTokenChange;
}

export interface SourceChange {
  changedSpan: SourceSpan;
  nextSource: string;
  offsetDelta: number;
}

// Scanner-owned top-level records combine source and token geometry.
export interface BlockRecord extends SourceSpan {
  // Furthest source boundary whose contents can affect this record.
  dependencyEnd: number;
  tokenStart: number;
}

type RootSequence = (TopLevelContent | number)[];

export class BlockScanContext {
  #lineViews: BlockLines[] = [];
  #scanDepth = 0;
  #lookaheadEnd = 0;
  #profile: BlockProfile;
  #unwrappedLine = new BlockLines();
  startsInterruptingBlock: BlockProfile["interrupt"];

  constructor(profile: BlockProfile) {
    this.#profile = profile;
    this.startsInterruptingBlock = profile.interrupt;
  }

  endsWithParagraphLeaf(source: string, lines: BlockLines, index: number): boolean {
    let contentLines = lines;
    let contentIndex = index;
    while (true) {
      const contentOffset = lineIndentOffset(source, contentLines, contentIndex);
      if (contentOffset < 0) {
        return false;
      }
      let unwrapped = false;
      for (const unwrap of this.#profile.unwraps) {
        unwrapped = unwrap(source, contentLines, contentIndex, contentOffset, this.#unwrappedLine);
        if (unwrapped) {
          break;
        }
      }
      if (unwrapped) {
        contentLines = this.#unwrappedLine;
        contentIndex = 0;
        continue;
      }
      return !this.startsInterruptingBlock(source, contentLines, contentIndex, contentOffset);
    }
  }

  retainLookahead(end: number): void {
    this.#lookaheadEnd = Math.max(this.#lookaheadEnd, end);
  }

  resetLookahead(): void {
    this.#lookaheadEnd = 0;
  }

  consumeLookahead(): number {
    const end = this.#lookaheadEnd;
    this.#lookaheadEnd = 0;
    return end;
  }

  /** Borrows the projected view for children of the active scan. */
  createLineView(
    lines: BlockLines,
    index: number,
    start: number,
    prefixColumns: number,
  ): BlockLines {
    const depth = this.#scanDepth - 1;
    const view = this.#lineViews[depth] ??= new BlockLines();
    view.resetFrom(lines, index, start, prefixColumns);
    return view;
  }

  /** Scans direct blocks in a line view and visits their line and token ranges. */
  scanBlockLines(
    source: string,
    lines: BlockLines,
    tokens: BlockTokenStream,
    visit?: (lineStart: number, lineEnd: number, tokenStart: number) => void,
    stopsBefore?: (start: number) => boolean,
    sequence?: RootSequence,
  ): void {
    const { starts, fallback } = this.#profile;
    this.#scanDepth++;
    try {
      for (let index = 0; index < lines.length;) {
        let start = lines.start(index);
        let lineEnd = lines.end(index);
        while (start === lineEnd) {
          if (++index === lines.length) {
            return;
          }
          start = lines.start(index);
          lineEnd = lines.end(index);
        }
        // Scan leading whitespace once to distinguish blank lines from block indent.
        let contentOffset = start;
        let columns = lines.prefixColumns(index);
        let code = Character.VirtualBlockIndent;
        while (contentOffset < lineEnd) {
          code = source.charCodeAt(contentOffset);
          if (code !== Character.Space && code !== Character.CharacterTabulation) {
            break;
          }
          columns += code === Character.Space ? 1 : 4 - columns % 4;
          contentOffset++;
        }
        if (contentOffset === lineEnd) {
          index++;
          continue;
        }
        if (stopsBefore?.(start)) {
          return;
        }
        if (columns > 3) {
          contentOffset = -1;
          code = Character.VirtualBlockIndent;
        }
        const lineStart = index;
        const tokenStart = tokens.length;
        const result = (
          starts[code + 1]?.(source, lines, tokens, index, contentOffset, this) ??
          fallback?.(source, lines, tokens, index, contentOffset, this)
        );
        if (result === void 0) {
          throw new Error("No block fallback");
        }
        if (typeof result === "number") {
          index = result;
          sequence?.push(lineStart);
        }
        else {
          index = result.nextLine;
          if (sequence) {
            const last = index - 1;
            const afterEnding = result.end > lines.end(last) && result.end === lines.next(last);
            result.node.position = {
              start: {
                line: lineStart + 1,
                column: result.start - start + 1,
                offset: result.start,
              },
              end: {
                line: last + (afterEnding ? 2 : 1),
                column: afterEnding ? 1 : result.end - lines.start(last) + 1,
                offset: result.end,
              },
            };
            sequence.push(result.node);
          }
          else {
            tokens.push(BlockKind.DirectNode, result.start, result.end, result);
          }
        }
        visit?.(lineStart, index, tokenStart);
      }
    }
    finally {
      this.#scanDepth--;
    }
  }
}

// Projection and inline resolution borrow only the scanner's indexed semantic view.
export type BlockStructure = Pick<BlockScanner, "builds" | "records" | "tokens">;

export class BlockScanner {
  #context: BlockScanContext;
  #lines = new BlockLines();
  #records: BlockRecord[] = [];
  #tokens = new BlockTokenStream();
  readonly builds: BlockProfile["builds"];

  constructor(profile: BlockProfile) {
    this.#context = new BlockScanContext(profile);
    this.builds = profile.builds;
  }

  parse(source: string, profile: InlineProfile): Root {
    this.#reset(source);
    const children: RootSequence = [];
    this.#context.scanBlockLines(source, this.#lines, this.#tokens, void 0, void 0, children);
    const lines = this.#lines;
    const locator = lines.locator();
    const context: BlockBuildContext = {
      inlineContext: void 0,
      cursor: void 0,
      locator,
      structure: this,
      profile,
      source,
    };

    const start = locator.locationAt(0);
    let token = 0;
    for (let index = 0; index < children.length; index++) {
      const entry = children[index];
      if (typeof entry === "number") {
        lines.advanceToLine(entry);
        children[index] = buildBlockNode(token, context);
        token += this.#tokens.nodeLength(token);
      }
    }

    return {
      type: "root",
      children: children as TopLevelContent[],
      position: { start, end: locator.locationAt(source.length) },
    };
  }

  #reset(source: string): void {
    this.#context.resetLookahead();
    this.#lines.scan(source, true);
    this.#tokens.reset();
  }

  scan(source: string): void {
    this.#reset(source);
    const context = this.#context;
    const lines = this.#lines;
    const tokens = this.#tokens;
    const records = this.#records;
    let recordIndex = 0;

    context.scanBlockLines(source, lines, tokens, (lineStart, lineEnd, tokenStart) => {
      const end = lines.next(lineEnd - 1);
      const dependencyEnd = Math.max(end, context.consumeLookahead());
      const record = records[recordIndex++];
      // Reuse top-level records across indexed scans instead of allocating one per block.
      if (record) {
        record.start = lines.start(lineStart);
        record.end = end;
        record.dependencyEnd = dependencyEnd;
        record.tokenStart = tokenStart;
      }
      else {
        records.push({
          start: lines.start(lineStart),
          end,
          dependencyEnd,
          tokenStart,
        });
      }
    });
    records.length = recordIndex;
  }

  get tokens(): BlockTokenStream {
    return this.#tokens;
  }

  get records(): readonly BlockRecord[] {
    return this.#records;
  }

  locator(): SourceLocator {
    return this.#lines.locator();
  }

  edit(change: SourceChange): BlockScanChange {
    const { changedSpan, nextSource, offsetDelta } = change;
    const context = this.#context;
    // Map the new damage end back to the old source with the total edit delta.
    const oldChangedEnd = changedSpan.end - offsetDelta;

    // 1. Locate a conservative block restart and update the physical lines around the edit.
    const previousRecords = this.#records;
    let affectedIndex = previousRecords.findIndex((record) => record.dependencyEnd >= changedSpan.start);
    if (affectedIndex < 0) {
      affectedIndex = Math.max(0, previousRecords.length - 1);
    }
    const affectedRecord = previousRecords[affectedIndex];
    const restartIndex = (
      // Only the leading gap has no preceding record to provide the usual one-record lookbehind.
      affectedIndex === 0 && affectedRecord?.start > changedSpan.start
        ? -1
        : affectedRecord && affectedRecord.end < changedSpan.start
          ? affectedIndex
          : Math.max(0, affectedIndex - 1)
    );
    const restartRecord = previousRecords[restartIndex];
    const restartOffset = restartRecord?.start ?? 0;
    const nextLines = this.#lines.update(nextSource, changedSpan.start, oldChangedEnd, offsetDelta);
    const scanLineStart = nextLines.indexAtOrAfter(restartOffset);
    const stableBlockCount = Math.max(0, restartIndex);
    const oldTokenStart = restartRecord?.tokenStart ?? 0;

    // 2. Rescan from that boundary until the unchanged suffix starts at a shared root block boundary.
    const replacement = new BlockTokenStream();
    const rescannedRecords: BlockRecord[] = [];
    const scanLines = scanLineStart === 0 ? nextLines : nextLines.view(scanLineStart);
    let oldRecordEnd = previousRecords.length;
    let candidate = affectedIndex;
    context.resetLookahead();
    context.scanBlockLines(
      nextSource,
      scanLines,
      replacement,
      (lineStart, lineEnd, tokenStart) => {
        const end = scanLines.next(lineEnd - 1);
        rescannedRecords.push({
          start: scanLines.start(lineStart),
          end,
          dependencyEnd: Math.max(end, context.consumeLookahead()),
          tokenStart: oldTokenStart + tokenStart,
        });
      },
      (start) => {
        if (start < changedSpan.end) {
          return false;
        }
        const oldStart = start - offsetDelta;
        // Moving a block across offset zero can change frontmatter recognition.
        if (offsetDelta && (start === 0 || oldStart === 0) && this.builds[BlockKind.Frontmatter]) {
          return false;
        }
        while (candidate < previousRecords.length && previousRecords[candidate].start < oldStart) {
          candidate++;
        }
        if (previousRecords[candidate]?.start !== oldStart) {
          return false;
        }
        oldRecordEnd = candidate;
        return true;
      },
    );

    // 3. Replace the rescanned token window, then map the narrowed token damage to record ranges.
    const oldTokenLength = this.#tokens.length;
    const oldTokenEnd = previousRecords[oldRecordEnd]?.tokenStart ?? oldTokenLength;
    const tokenChange: BlockTokenChange = this.#tokens.replace(
      oldTokenStart,
      oldTokenEnd,
      replacement,
      changedSpan.start,
      oldChangedEnd,
      offsetDelta,
    );
    const tokenDelta = tokenChange.newEnd - tokenChange.oldEnd;
    // Record ranges are contiguous, and their starts remain in old coordinates until suffix shifting below.
    let oldRecordStart = stableBlockCount;
    while (
      oldRecordStart < previousRecords.length &&
      (previousRecords[oldRecordStart + 1]?.tokenStart ?? oldTokenLength) <= tokenChange.oldStart
    ) {
      oldRecordStart++;
    }
    const nextRecords = previousRecords.slice(0, stableBlockCount);
    nextRecords.push(...rescannedRecords);
    const shiftSuffix = offsetDelta !== 0 || tokenDelta !== 0;
    for (let index = oldRecordEnd; index < previousRecords.length; index++) {
      const record = previousRecords[index];
      if (shiftSuffix) {
        record.start += offsetDelta;
        record.end += offsetDelta;
        record.dependencyEnd += offsetDelta;
        record.tokenStart += tokenDelta;
      }
      nextRecords.push(record);
    }
    const newRecordEnd = oldRecordEnd + nextRecords.length - previousRecords.length;

    // 4. Commit the matching physical lines and reconciled records as scanner state.
    this.#lines = nextLines;
    this.#records = nextRecords;

    return {
      newRecordEnd,
      offsetDelta,
      oldRecordEnd,
      oldRecordStart,
      stableBlockCount,
      tokenChange,
    };
  }
}
