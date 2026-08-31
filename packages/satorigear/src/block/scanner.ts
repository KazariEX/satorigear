import { Character } from "../constants/character.ts";
import { BlockLines, isBlank, lineIndentOffset } from "./lines.ts";
import { type BlockTokenChange, BlockTokenStream } from "./tokens.ts";
import type { SourceLocator, SourceSpan } from "../source-view.ts";
import type { BlockProfile, BlockSyntaxRule } from "./profile.ts";

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

function scanBlockLines(
  profile: BlockProfile,
  context: BlockScanContext,
  source: string,
  lines: BlockLines,
  out: BlockTokenStream,
  visit: (lineStart: number, lineEnd: number, tokenStart: number, tokenEnd: number) => true | void,
): void {
  for (let index = 0; index < lines.length;) {
    // Scan leading whitespace once to distinguish blank lines from block indent.
    let contentOffset = lines.start(index);
    const lineEnd = lines.end(index);
    let columns = lines.prefixColumns(index);
    while (contentOffset < lineEnd) {
      const code = source.charCodeAt(contentOffset);
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
    if (columns > 3) {
      contentOffset = -1;
    }
    const lineStart = index;
    const tokenStart = out.length;
    index = profile.dispatch(source, lines, index, contentOffset, out, context);
    if (visit(lineStart, index, tokenStart, out.length)) {
      return;
    }
  }
}

function sameShiftedBlock(
  previous: BlockTokenStream,
  record: BlockRecord,
  next: BlockTokenStream,
  tokenStart: number,
  tokenEnd: number,
  delta: number,
): boolean {
  const length = previous.nodeLength(record.tokenStart);
  if (length !== tokenEnd - tokenStart) {
    return false;
  }
  // Convergence only considers the unchanged source suffix, so matching geometry
  // also proves that each token covers the same text after the shift.
  for (let index = 0; index < length; index++) {
    if (!previous.equalsAfterShift(
      record.tokenStart + index,
      next,
      tokenStart + index,
      delta,
    )) {
      return false;
    }
  }
  return true;
}

export class BlockScanContext {
  #lineViewDepth = 0;
  #lineViews: BlockLines[] = [];
  #lookaheadEnd = 0;
  #profile: BlockProfile;
  #unwrappedLine = new BlockLines();

  constructor(profile: BlockProfile) {
    this.#profile = profile;
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
      for (const unwrap of this.#profile.lazyContinuationUnwrappers) {
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

  /** Starts a depth-owned projected view; {@link scanLines} releases it after recursive scanning. */
  createLineView(
    lines: BlockLines,
    index: number,
    start: number,
    prefixColumns: number,
  ): BlockLines {
    const depth = this.#lineViewDepth++;
    const view = this.#lineViews[depth] ??= new BlockLines();
    view.resetFrom(lines, index, start, prefixColumns);
    return view;
  }

  // Returns whether blank lines separate direct blocks in this line view.
  scanLines(source: string, lines: BlockLines, out: BlockTokenStream): boolean {
    let blankSeparated = false;
    let previousContentEnd = -1;
    scanBlockLines(this.#profile, this, source, lines, out, (lineStart, lineEnd) => {
      blankSeparated ||= previousContentEnd >= 0 && lineStart > previousContentEnd;
      previousContentEnd = lineEnd;
      // A child may consume trailing blank lines that still separate the following direct block.
      while (previousContentEnd > lineStart && isBlank(source, lines, previousContentEnd - 1)) {
        previousContentEnd--;
      }
    });
    if (lines === this.#lineViews[this.#lineViewDepth - 1]) {
      this.#lineViewDepth--;
    }
    return blankSeparated;
  }

  startsInterruptingBlock(
    source: string,
    lines: BlockLines,
    index: number,
    contentOffset = lineIndentOffset(source, lines, index),
  ): boolean {
    if (contentOffset < 0) {
      return false;
    }
    const interrupts = this.#profile.interrupts[source.charCodeAt(contentOffset)];
    if (!interrupts) {
      return false;
    }
    for (const interrupt of interrupts) {
      if (interrupt(source, lines, index, contentOffset)) {
        return true;
      }
    }
    return false;
  }
}

// Projection and inline resolution borrow only the scanner's indexed semantic view.
export type BlockStructure = Pick<BlockScanner, "records" | "ruleOf" | "tokens">;

export class BlockScanner {
  #context: BlockScanContext;
  #lines = new BlockLines();
  #profile: BlockProfile;
  #records: BlockRecord[] = [];
  #tokens = new BlockTokenStream();

  constructor(profile: BlockProfile) {
    this.#context = new BlockScanContext(profile);
    this.#profile = profile;
  }

  scan(source: string): void {
    const lines = this.#lines.scan(source);
    const tokens = this.#tokens;
    tokens.reset(source.length);
    const records = this.#records;
    const context = this.#context;
    let recordIndex = 0;
    context.resetLookahead();
    scanBlockLines(this.#profile, context, source, lines, tokens, (lineStart, lineEnd, tokenStart) => {
      const end = lines.next(lineEnd - 1);
      const dependencyEnd = Math.max(end, context.consumeLookahead());
      const record = records[recordIndex++];
      // Reuse top-level records across one-shot parses instead of allocating one per block.
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

  ruleOf(tokenStart: number): BlockSyntaxRule {
    const kind = this.#tokens.kind(tokenStart);
    return this.#profile.rules[kind]!;
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
    const nextLines = this.#lines.update(nextSource, restartOffset, oldChangedEnd, offsetDelta);
    const scanLineStart = nextLines.indexAtOrAfter(restartOffset);
    const stableBlockCount = Math.max(0, restartIndex);
    const oldTokenStart = restartRecord?.tokenStart ?? 0;

    // 2. Rescan from that boundary until block geometry and shifted tokens match an old record.
    const replacement = new BlockTokenStream(nextSource.length);
    const rescannedRecords: BlockRecord[] = [];
    const initialEndRecord = previousRecords[Math.min(previousRecords.length - 1, affectedIndex + 2)];
    let convergedIndex = -1;
    let scanLineEnd = nextLines.indexAtOrAfter(
      Math.min(
        nextSource.length,
        Math.max(changedSpan.end, (initialEndRecord?.end ?? nextSource.length) + offsetDelta),
      ),
    );
    while (true) {
      const scanEnd = scanLineEnd < nextLines.length ? nextLines.start(scanLineEnd) : nextSource.length;
      const scanLines = nextLines.slice(scanLineStart, scanLineEnd);
      let convergenceIndex = affectedIndex;
      context.resetLookahead();
      // The visitor is consumed synchronously before this window can be expanded.
      // eslint-disable-next-line no-loop-func
      scanBlockLines(this.#profile, context, nextSource, scanLines, replacement, (
        lineStart,
        lineEnd,
        tokenStart,
        tokenEnd,
      ) => {
        const blockStart = scanLines.start(lineStart);
        const blockEnd = scanLines.next(lineEnd - 1);
        const observedEnd = context.consumeLookahead();
        const dependencyEnd = Math.max(blockEnd, observedEnd);
        // A failed probe that reached the temporary boundary needs a larger window before convergence is meaningful.
        if (observedEnd >= scanEnd && scanEnd < nextSource.length) {
          return true;
        }
        // A block at the temporary boundary may change in the next window.
        if (
          blockEnd >= changedSpan.end && (
            blockEnd < scanEnd || scanEnd === nextSource.length
          )
        ) {
          const candidateStart = Math.max(oldChangedEnd, blockStart - offsetDelta);
          while (
            convergenceIndex < previousRecords.length &&
            previousRecords[convergenceIndex].start < candidateStart
          ) {
            convergenceIndex++;
          }
          const candidateRecord = previousRecords[convergenceIndex];
          if (
            candidateRecord?.start + offsetDelta === blockStart &&
            candidateRecord.end + offsetDelta === blockEnd &&
            candidateRecord.dependencyEnd + offsetDelta === dependencyEnd &&
            sameShiftedBlock(
              this.#tokens,
              candidateRecord,
              replacement,
              tokenStart,
              tokenEnd,
              offsetDelta,
            )
          ) {
            replacement.truncate(tokenStart);
            convergedIndex = convergenceIndex;
            return true;
          }
        }
        rescannedRecords.push({
          start: blockStart,
          end: blockEnd,
          dependencyEnd,
          tokenStart: oldTokenStart + tokenStart,
        });
      });
      if (convergedIndex >= 0 || scanEnd === nextSource.length) {
        break;
      }
      replacement.reset(nextSource.length);
      rescannedRecords.length = 0;
      const expandedEnd = Math.min(nextSource.length, restartOffset + (scanEnd - restartOffset) * 2);
      scanLineEnd = nextLines.indexAtOrAfter(expandedEnd);
    }

    // 3. Replace the rescanned token window, then map the narrowed token damage to record ranges.
    const oldTokenLength = this.#tokens.length;
    const oldTokenEnd = convergedIndex < 0
      ? oldTokenLength
      : previousRecords[convergedIndex].tokenStart;
    const tokenChange: BlockTokenChange = this.#tokens.replace(
      oldTokenStart,
      oldTokenEnd,
      replacement,
      changedSpan.start,
      oldChangedEnd,
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
    let oldRecordEnd = oldRecordStart;
    while (
      oldRecordEnd < previousRecords.length &&
      previousRecords[oldRecordEnd].tokenStart < tokenChange.oldEnd
    ) {
      oldRecordEnd++;
    }

    const nextRecords = previousRecords.slice(0, stableBlockCount);
    nextRecords.push(...rescannedRecords);
    const shiftSuffix = offsetDelta !== 0 || tokenDelta !== 0;
    if (convergedIndex >= 0) {
      for (let index = convergedIndex; index < previousRecords.length; index++) {
        const record = previousRecords[index];
        if (shiftSuffix) {
          record.start += offsetDelta;
          record.end += offsetDelta;
          record.dependencyEnd += offsetDelta;
          record.tokenStart += tokenDelta;
        }
        nextRecords.push(record);
      }
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
