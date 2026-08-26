import { BlockLines, isBlank, lineIndentOffset } from "./lines.ts";
import { type BlockTokenChange, BlockTokenStream } from "./tokens.ts";
import type { SourceLocation, SourceSpan } from "../source-view.ts";
import type { BlockProfile, BlockSyntaxRule } from "./profile.ts";

export interface BlockScanContext {
  endsWithParagraphLeaf: (source: string, lines: BlockLines, index: number) => boolean;
  retainLookahead: (end: number) => void;
  // Returns whether blank lines separate direct blocks in this line view.
  scanLines: (source: string, lines: BlockLines, tokens: BlockTokenStream) => boolean;
  startsInterruptingBlock: (
    source: string,
    lines: BlockLines,
    index: number,
    contentOffset?: number,
  ) => boolean;
}

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

function startsInterruptingBlock(
  profile: BlockProfile,
  source: string,
  lines: BlockLines,
  index: number,
  contentOffset = lineIndentOffset(source, lines, index),
): boolean {
  if (contentOffset < 0) {
    return false;
  }
  const interrupts = profile.interrupts[source.charCodeAt(contentOffset)];
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

function endsWithParagraphLeaf(
  profile: BlockProfile,
  context: BlockScanContext,
  source: string,
  lines: BlockLines,
  index: number,
  unwrappedLine: BlockLines,
): boolean {
  let contentLines = lines;
  let contentIndex = index;
  while (true) {
    const contentOffset = lineIndentOffset(source, contentLines, contentIndex);
    if (contentOffset < 0) {
      return false;
    }
    let unwrapped = false;
    for (const unwrap of profile.lazyContinuationUnwrappers) {
      unwrapped = unwrap(source, contentLines, contentIndex, contentOffset, unwrappedLine);
      if (unwrapped) {
        break;
      }
    }
    if (unwrapped) {
      contentLines = unwrappedLine;
      contentIndex = 0;
      continue;
    }
    return (
      !isBlank(source, contentLines, contentIndex) &&
      !context.startsInterruptingBlock(source, contentLines, contentIndex, contentOffset)
    );
  }
}

function scanBlock(
  profile: BlockProfile,
  context: BlockScanContext,
  source: string,
  lines: BlockLines,
  start: number,
  out: BlockTokenStream,
): number {
  const contentOffset = lineIndentOffset(source, lines, start);
  if (contentOffset >= 0) {
    const starts = profile.starts[source.charCodeAt(contentOffset)];
    if (starts) {
      for (const resolve of starts) {
        const end = resolve(source, lines, start, contentOffset, out, context);
        if (end !== void 0) {
          return end;
        }
      }
    }
  }
  for (const fallback of profile.fallbacks) {
    const fallbackEnd = fallback(source, lines, start, contentOffset, out, context);
    if (fallbackEnd !== void 0) {
      return fallbackEnd;
    }
  }
  throw new Error("Syntax profile did not provide a block fallback");
}

function scanBlockLines(
  profile: BlockProfile,
  context: BlockScanContext,
  source: string,
  lines: BlockLines,
  out: BlockTokenStream,
  visit?: (lineStart: number, lineEnd: number, tokenStart: number, tokenEnd: number) => boolean,
): void {
  for (let index = 0; index < lines.length;) {
    if (isBlank(source, lines, index)) {
      index++;
      continue;
    }
    const lineStart = index;
    const tokenStart = out.length;
    index = scanBlock(profile, context, source, lines, index, out);
    if (visit?.(lineStart, index, tokenStart, out.length)) {
      return;
    }
  }
}

function scanSeparatedBlockLines(
  profile: BlockProfile,
  context: BlockScanContext,
  source: string,
  lines: BlockLines,
  out: BlockTokenStream,
): boolean {
  let blankSeparated = false;
  let previousContentEnd = -1;
  scanBlockLines(profile, context, source, lines, out, (lineStart, lineEnd) => {
    blankSeparated ||= previousContentEnd >= 0 && lineStart > previousContentEnd;
    previousContentEnd = lineEnd;
    // A child may consume trailing blank lines that still separate the following direct block.
    while (previousContentEnd > lineStart && isBlank(source, lines, previousContentEnd - 1)) {
      previousContentEnd--;
    }
    return false;
  });
  return blankSeparated;
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

// Projection and inline resolution borrow only the scanner's indexed semantic view.
export type BlockStructure = Pick<BlockScanner, "records" | "ruleOf" | "tokens">;

export class BlockScanner {
  #context: BlockScanContext;
  #lines: BlockLines;
  #lookaheadEnd: number;
  #profile: BlockProfile;
  #records: BlockRecord[];
  #tokens: BlockTokenStream;

  constructor(profile: BlockProfile) {
    const unwrappedLine = new BlockLines();
    this.#context = {
      endsWithParagraphLeaf: (source, lines, index) => endsWithParagraphLeaf(
        profile,
        this.#context,
        source,
        lines,
        index,
        unwrappedLine,
      ),
      retainLookahead: (end) => {
        this.#lookaheadEnd = Math.max(this.#lookaheadEnd, end);
      },
      scanLines: (source, lines, tokens) => scanSeparatedBlockLines(profile, this.#context, source, lines, tokens),
      startsInterruptingBlock: (source, lines, index, contentOffset) => startsInterruptingBlock(
        profile,
        source,
        lines,
        index,
        contentOffset,
      ),
    };
    this.#profile = profile;
    this.#lines = new BlockLines();
    this.#lookaheadEnd = 0;
    this.#records = [];
    this.#tokens = new BlockTokenStream();
  }

  scan(source: string): void {
    const lines = BlockLines.from(source);
    const tokens = this.#tokens;
    tokens.reset(source.length);
    const records = this.#records;
    let recordIndex = 0;
    this.#lookaheadEnd = 0;
    scanBlockLines(this.#profile, this.#context, source, lines, tokens, (lineStart, lineEnd, tokenStart) => {
      const end = lines.next(lineEnd - 1);
      const dependencyEnd = Math.max(end, this.#lookaheadEnd);
      this.#lookaheadEnd = 0;
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
      return false;
    });
    tokens.indexStructure(this.#profile.rules);
    records.length = recordIndex;

    this.#lines = lines;
  }

  get tokens(): BlockTokenStream {
    return this.#tokens;
  }

  get records(): readonly BlockRecord[] {
    return this.#records;
  }

  ruleOf(tokenStart: number): BlockSyntaxRule {
    const kind = this.#tokens.kind(tokenStart);
    const rule = this.#profile.rules[kind];
    if (!rule) {
      throw new Error(`Block token ${tokenStart} does not begin a semantic node`);
    }
    return rule;
  }

  locator(): (offset: number) => SourceLocation {
    return this.#lines.locator();
  }

  edit(change: SourceChange): BlockScanChange {
    const { changedSpan, nextSource, offsetDelta } = change;
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
      this.#lookaheadEnd = 0;
      // The visitor is consumed synchronously before this window can be expanded.
      // eslint-disable-next-line no-loop-func
      scanBlockLines(this.#profile, this.#context, nextSource, scanLines, replacement, (
        lineStart,
        lineEnd,
        tokenStart,
        tokenEnd,
      ) => {
        const blockStart = scanLines.start(lineStart);
        const blockEnd = scanLines.next(lineEnd - 1);
        const observedEnd = this.#lookaheadEnd;
        const dependencyEnd = Math.max(blockEnd, observedEnd);
        this.#lookaheadEnd = 0;
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
        return false;
      });
      if (convergedIndex >= 0 || scanEnd === nextSource.length) {
        break;
      }
      replacement.reset(nextSource.length);
      rescannedRecords.length = 0;
      const expandedEnd = Math.min(nextSource.length, restartOffset + (scanEnd - restartOffset) * 2);
      scanLineEnd = nextLines.indexAtOrAfter(expandedEnd);
    }
    replacement.indexStructure(this.#profile.rules);

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
