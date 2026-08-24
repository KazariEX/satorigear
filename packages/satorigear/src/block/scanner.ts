import { Character } from "../constants/character.ts";
import { type BlockLine, firstLineIndexAtOrAfter, indentOf, isBlank, lineIndent } from "./lines.ts";
import { type BlockTokenChange, BlockTokenStream } from "./tokens.ts";
import type { SourceLocation, SourceSpan } from "../source-view.ts";
import type { BlockProfile } from "./profile.ts";

export interface BlockScanContext {
  endsWithParagraphLeaf: (source: string, line: BlockLine) => boolean;
  retainLookahead: (end: number) => void;
  // Returns whether blank lines separate direct blocks in this line view.
  scanLines: (source: string, lines: readonly BlockLine[], tokens: BlockTokenStream) => boolean;
  startsInterruptingBlock: (source: string, line: BlockLine) => boolean;
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

// Scanner-owned top-level identity combines physical-line and token geometry.
export interface BlockRecord extends SourceSpan {
  // Furthest source boundary whose contents can affect this record.
  dependencyEnd: number;
  tokenEnd: number;
  tokenStart: number;
}

function profileStarts(
  profile: BlockProfile,
  context: BlockScanContext,
  source: string,
  lines: readonly BlockLine[],
  start: number,
  out: BlockTokenStream,
): number | undefined {
  const indent = lineIndent(source, lines[start]);
  if (!indent) {
    return;
  }
  const starts = profile.starts[source.charCodeAt(indent.offset)];
  if (!starts) {
    return;
  }
  for (const resolve of starts) {
    const end = resolve(source, lines, start, out, indent.offset, context);
    if (end !== void 0) {
      return end;
    }
  }
}

function startsInterruptingBlock(profile: BlockProfile, source: string, line: BlockLine): boolean {
  const indent = lineIndent(source, line);
  if (!indent) {
    return false;
  }
  const interrupts = profile.interrupts[source.charCodeAt(indent.offset)];
  if (!interrupts) {
    return false;
  }
  for (const interrupt of interrupts) {
    if (interrupt(source, line, indent.offset)) {
      return true;
    }
  }
  return false;
}

function startsParagraphAt(context: BlockScanContext, source: string, line: BlockLine): boolean {
  return (
    !isBlank(source, line) &&
    !context.startsInterruptingBlock(source, line) &&
    indentOf(source, line).columns < 4
  );
}

function endsWithParagraphLeaf(
  profile: BlockProfile,
  context: BlockScanContext,
  source: string,
  line: BlockLine,
): boolean {
  let contentLine = line;
  while (true) {
    let unwrapped: BlockLine | undefined;
    for (const unwrap of profile.lazyContinuationUnwrappers) {
      unwrapped = unwrap(source, contentLine);
      if (unwrapped) {
        break;
      }
    }
    if (unwrapped) {
      contentLine = unwrapped;
      continue;
    }
    return startsParagraphAt(context, source, contentLine);
  }
}

function scanBlock(
  profile: BlockProfile,
  context: BlockScanContext,
  source: string,
  lines: readonly BlockLine[],
  start: number,
  out: BlockTokenStream,
): number {
  const matchedEnd = profileStarts(profile, context, source, lines, start, out);
  if (matchedEnd !== void 0) {
    return matchedEnd;
  }
  for (const fallback of profile.fallbacks) {
    const fallbackEnd = fallback(source, lines, start, out, context);
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
  lines: readonly BlockLine[],
  out: BlockTokenStream,
  visit?: (lineStart: number, lineEnd: number, tokenStart: number, tokenEnd: number) => boolean,
): void {
  for (let index = 0; index < lines.length;) {
    if (isBlank(source, lines[index])) {
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
  lines: readonly BlockLine[],
  out: BlockTokenStream,
): boolean {
  let blankSeparated = false;
  let previousContentEnd = -1;
  scanBlockLines(profile, context, source, lines, out, (lineStart, lineEnd) => {
    blankSeparated ||= previousContentEnd >= 0 && lineStart > previousContentEnd;
    previousContentEnd = lineEnd;
    // A child may consume trailing blank lines that still separate the following direct block.
    while (previousContentEnd > lineStart && isBlank(source, lines[previousContentEnd - 1])) {
      previousContentEnd--;
    }
    return false;
  });
  return blankSeparated;
}

function linesOf(source: string, start = 0, limit = source.length): BlockLine[] {
  const lines: BlockLine[] = [];
  const sourceOffset = start;
  // Bound the search window explicitly because String#indexOf has no end limit.
  if (start > 0 || limit < source.length) {
    source = source.slice(start, limit);
    start = 0;
    limit = source.length;
  }
  let lineFeed = source.indexOf("\n", start);
  let carriageReturn = source.indexOf("\r", start);
  while (start < limit) {
    const nextEnding = lineFeed < 0
      ? carriageReturn
      : carriageReturn < 0 ? lineFeed : Math.min(lineFeed, carriageReturn);
    const end = nextEnding < 0 || nextEnding >= limit ? limit : nextEnding;
    let next = end;
    if (next < limit) {
      if (next === carriageReturn) {
        next += next + 1 < limit && source.charCodeAt(next + 1) === Character.LineFeed ? 2 : 1;
        carriageReturn = source.indexOf("\r", next);
        if (lineFeed < next) {
          lineFeed = source.indexOf("\n", next);
        }
      }
      else {
        next++;
        lineFeed = source.indexOf("\n", next);
      }
    }
    lines.push({
      start: sourceOffset + start,
      end: sourceOffset + end,
      next: sourceOffset + next,
    });
    start = next;
  }
  return lines;
}

function updatePhysicalLines(
  previous: readonly BlockLine[],
  nextSource: string,
  restartOffset: number,
  oldDamageEnd: number,
  delta: number,
): BlockLine[] {
  // Rebuild one following line so edits at line-ending boundaries cannot retain stale geometry.
  const suffix = Math.min(previous.length, firstLineIndexAtOrAfter(previous, oldDamageEnd + 1) + 1);
  const oldSuffixOffset = previous[suffix]?.start ?? nextSource.length - delta;
  const newSuffixOffset = oldSuffixOffset + delta;
  const prefixEnd = firstLineIndexAtOrAfter(previous, restartOffset);
  const changed = linesOf(nextSource, restartOffset, newSuffixOffset);
  if (delta === 0 && changed.length === suffix - prefixEnd) {
    const next = previous.slice();
    for (let index = 0; index < changed.length; index++) {
      next[prefixEnd + index] = changed[index];
    }
    return next;
  }
  // Assemble a new owner once; mutating previous suffix lines before scanning would break edit atomicity.
  const next = new Array<BlockLine>(prefixEnd + changed.length + previous.length - suffix);
  let write = 0;
  for (let index = 0; index < prefixEnd; index++) {
    next[write++] = previous[index];
  }
  for (const line of changed) {
    next[write++] = line;
  }
  for (let index = suffix; index < previous.length; index++) {
    const line = previous[index];
    next[write++] = delta === 0
      ? line
      : {
        start: line.start + delta,
        end: line.end + delta,
        next: line.next + delta,
      };
  }
  return next;
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

export class BlockScanner {
  #context: BlockScanContext;
  #lines: BlockLine[];
  #lookaheadEnd: number;
  #profile: BlockProfile;
  #records: BlockRecord[];
  #tokens: BlockTokenStream;

  constructor(profile: BlockProfile) {
    this.#context = {
      endsWithParagraphLeaf: (source, line) => endsWithParagraphLeaf(profile, this.#context, source, line),
      retainLookahead: (end) => {
        this.#lookaheadEnd = Math.max(this.#lookaheadEnd, end);
      },
      scanLines: (source, lines, tokens) => scanSeparatedBlockLines(profile, this.#context, source, lines, tokens),
      startsInterruptingBlock: (source, line) => startsInterruptingBlock(profile, source, line),
    };
    this.#profile = profile;
    this.#lines = [];
    this.#lookaheadEnd = 0;
    this.#records = [];
    this.#tokens = new BlockTokenStream();
  }

  scan(source: string): void {
    const lines = linesOf(source);
    const tokens = this.#tokens;
    tokens.reset(source.length);
    const records = this.#records;
    let recordIndex = 0;
    this.#lookaheadEnd = 0;
    scanBlockLines(this.#profile, this.#context, source, lines, tokens, (lineStart, lineEnd, tokenStart, tokenEnd) => {
      const end = lines[lineEnd - 1].next;
      const dependencyEnd = Math.max(end, this.#lookaheadEnd);
      this.#lookaheadEnd = 0;
      const record = records[recordIndex++];
      // Reuse top-level records across one-shot parses instead of allocating one per block.
      if (record) {
        record.start = lines[lineStart].start;
        record.end = end;
        record.dependencyEnd = dependencyEnd;
        record.tokenStart = tokenStart;
        record.tokenEnd = tokenEnd;
      }
      else {
        records.push({
          start: lines[lineStart].start,
          end,
          dependencyEnd,
          tokenStart,
          tokenEnd,
        });
      }
      return false;
    });
    tokens.indexStructure(this.#profile.schema);
    records.length = recordIndex;

    this.#lines = lines;
  }

  get tokens(): BlockTokenStream {
    return this.#tokens;
  }

  get records(): readonly BlockRecord[] {
    return this.#records;
  }

  // Mdast materialization visits nested spans in source order, so one cursor replaces a binary search per point.
  locator(): (offset: number) => SourceLocation {
    const lines = this.#lines;
    const sourceLength = this.#tokens.sourceLength;
    const endsInLineEnding = lines.length > 0 && lines[lines.length - 1].end < sourceLength;

    if (lines.length === 0) {
      return (offset) => ({ line: 1, column: 1, offset });
    }
    let line = 0;
    return (offset) => {
      if (offset === sourceLength && endsInLineEnding) {
        return { line: lines.length + 1, column: 1, offset };
      }
      while (line + 1 < lines.length && lines[line + 1].start <= offset) {
        line++;
      }
      return { line: line + 1, column: offset - lines[line].start + 1, offset };
    };
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
    const restartIndex = affectedRecord?.start > changedSpan.start
      ? -1
      : affectedRecord && affectedRecord.end < changedSpan.start
        ? affectedIndex
        : Math.max(0, affectedIndex - 1);
    const restartRecord = previousRecords[restartIndex];
    const restartOffset = restartRecord?.start ?? 0;
    const nextLines = updatePhysicalLines(this.#lines, nextSource, restartOffset, oldChangedEnd, offsetDelta);
    const stableBlockCount = Math.max(0, restartIndex);
    const oldTokenStart = restartRecord?.tokenStart ?? 0;

    // 2. Rescan from that boundary until block geometry and shifted tokens match an old record.
    const replacement = new BlockTokenStream(nextSource.length);
    const rescannedRecords: BlockRecord[] = [];
    let convergedIndex = -1;
    const initialEndRecord = previousRecords[Math.min(previousRecords.length - 1, affectedIndex + 2)];
    let scanEnd = Math.min(
      nextSource.length,
      Math.max(changedSpan.end, (initialEndRecord?.end ?? nextSource.length) + offsetDelta),
    );
    scanEnd = nextLines[firstLineIndexAtOrAfter(nextLines, scanEnd)]?.start ?? nextSource.length;
    while (true) {
      const scanLines = linesOf(nextSource, restartOffset, scanEnd);
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
        const blockStart = scanLines[lineStart].start;
        const blockEnd = scanLines[lineEnd - 1].next;
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
          tokenEnd: oldTokenStart + tokenEnd,
        });
        return false;
      });
      if (convergedIndex >= 0 || scanEnd === nextSource.length) {
        break;
      }
      replacement.reset(nextSource.length);
      rescannedRecords.length = 0;
      const expandedEnd = Math.min(nextSource.length, restartOffset + (scanEnd - restartOffset) * 2);
      const nextLine = firstLineIndexAtOrAfter(nextLines, expandedEnd);
      scanEnd = nextLines[nextLine]?.start ?? nextSource.length;
    }
    replacement.indexStructure(this.#profile.schema);

    // 3. Replace the rescanned token window, then reconcile record identity around the narrowed token damage.
    const oldTokenEnd = convergedIndex < 0
      ? this.#tokens.length
      : previousRecords[convergedIndex].tokenStart;
    const tokenChange: BlockTokenChange = this.#tokens.replace(
      oldTokenStart,
      oldTokenEnd,
      replacement,
      changedSpan.start,
      oldChangedEnd,
    );
    const tokenDelta = tokenChange.newEnd - tokenChange.oldEnd;
    let oldRecordStart = stableBlockCount;
    while (
      oldRecordStart < previousRecords.length &&
      previousRecords[oldRecordStart].tokenEnd <= tokenChange.oldStart
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
    const rescannedEnd = nextRecords.length;
    const shiftSuffix = offsetDelta !== 0 || tokenDelta !== 0;
    if (convergedIndex >= 0) {
      for (let index = convergedIndex; index < previousRecords.length; index++) {
        const record = previousRecords[index];
        if (shiftSuffix) {
          record.start += offsetDelta;
          record.end += offsetDelta;
          record.dependencyEnd += offsetDelta;
          record.tokenStart += tokenDelta;
          record.tokenEnd += tokenDelta;
        }
        nextRecords.push(record);
      }
    }

    const newRecordEnd = nextRecords.length - (previousRecords.length - oldRecordEnd);

    // Token equality can retain records inside the rescanned window even though line scanning restarted earlier.
    for (let index = stableBlockCount; index < oldRecordStart; index++) {
      const record = previousRecords[index];
      const nextRecord = nextRecords[index];
      record.start = nextRecord.start;
      record.end = nextRecord.end;
      record.dependencyEnd = nextRecord.dependencyEnd;
      record.tokenStart = nextRecord.tokenStart;
      record.tokenEnd = nextRecord.tokenEnd;
      nextRecords[index] = record;
    }
    const stableRescannedEnd = Math.min(
      previousRecords.length,
      oldRecordEnd + rescannedEnd - newRecordEnd,
    );
    // The retained suffix may begin inside the rescanned window; rebind that portion to its old identities.
    for (let index = oldRecordEnd; index < stableRescannedEnd; index++) {
      const record = previousRecords[index];
      const nextIndex = newRecordEnd + index - oldRecordEnd;
      const nextRecord = nextRecords[nextIndex];
      record.start = nextRecord.start;
      record.end = nextRecord.end;
      record.dependencyEnd = nextRecord.dependencyEnd;
      record.tokenStart = nextRecord.tokenStart;
      record.tokenEnd = nextRecord.tokenEnd;
      nextRecords[nextIndex] = record;
    }

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
