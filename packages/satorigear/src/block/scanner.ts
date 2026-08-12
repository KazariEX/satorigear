import { type BlockLine, indentOf, isBlank, lineIndent } from "./lines.ts";
import {
  type BlockToken,
  type BlockTokenChange,
  createShiftedToken,
  createTokenChange,
  tokenEqualsAfterShift,
} from "./tokens.ts";
import type { SourceLocation, SourceSpan } from "../source-view.ts";
import type { BlockProfile } from "./profile.ts";

export interface BlockScanContext {
  endsWithParagraphLeaf: (source: string, line: BlockLine) => boolean;
  startsInterruptingBlock: (source: string, line: BlockLine) => boolean;
  resolveLines: (source: string, lines: readonly BlockLine[], tokens: BlockToken[]) => void;
}

export interface BlockScanChange {
  stableBlockCount: number;
  tokenChange: BlockTokenChange;
}

function profileStarts(
  profile: BlockProfile,
  context: BlockScanContext,
  source: string,
  lines: readonly BlockLine[],
  start: number,
  out: BlockToken[],
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

function resolveBlock(
  profile: BlockProfile,
  context: BlockScanContext,
  source: string,
  lines: readonly BlockLine[],
  start: number,
  out: BlockToken[],
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

interface BlockCheckpoint {
  lineEnd: number;
  lineStart: number;
  tokenEnd: number;
  tokenStart: number;
}

function resolveLines(
  profile: BlockProfile,
  context: BlockScanContext,
  source: string,
  lines: readonly BlockLine[],
  out: BlockToken[],
  visit?: (lineStart: number, lineEnd: number, tokenStart: number, tokenEnd: number) => boolean,
): void {
  for (let index = 0; index < lines.length;) {
    if (isBlank(source, lines[index])) {
      index++;
      continue;
    }
    const lineStart = index;
    const tokenStart = out.length;
    index = resolveBlock(profile, context, source, lines, index, out);
    if (visit?.(lineStart, index, tokenStart, out.length)) {
      return;
    }
  }
}

function createBlockScanContext(profile: BlockProfile): BlockScanContext {
  const context: BlockScanContext = {
    endsWithParagraphLeaf: (source, line) => endsWithParagraphLeaf(profile, context, source, line),
    startsInterruptingBlock: (source, line) => startsInterruptingBlock(profile, source, line),
    resolveLines: (source, lines, tokens) => resolveLines(profile, context, source, lines, tokens),
  };
  return context;
}

function lineIndexAtOrAfter(lines: readonly BlockLine[], offset: number): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].start < offset) {
      low = middle + 1;
    }
    else {
      high = middle;
    }
  }
  return low;
}

function linesOf(source: string, start = 0, limit = source.length): BlockLine[] {
  const lines: BlockLine[] = [];
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
        next += next + 1 < limit && source.charCodeAt(next + 1) === 10 ? 2 : 1;
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
    lines.push({ start, end, next });
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
  const suffix = Math.min(previous.length, lineIndexAtOrAfter(previous, oldDamageEnd + 1) + 1);
  const oldSuffixOffset = previous[suffix]?.start ?? nextSource.length - delta;
  const newSuffixOffset = oldSuffixOffset + delta;
  const prefix = previous.slice(0, lineIndexAtOrAfter(previous, restartOffset));
  const changed = linesOf(nextSource, restartOffset, newSuffixOffset);
  const suffixLines = previous.slice(suffix);
  const unchanged = delta === 0
    ? suffixLines
    : suffixLines.map((line) => ({
      start: line.start + delta,
      end: line.end + delta,
      next: line.next + delta,
    }));
  return [...prefix, ...changed, ...unchanged];
}

function sameShiftedBlock(
  previous: readonly BlockToken[],
  checkpoint: BlockCheckpoint,
  next: readonly BlockToken[],
  tokenStart: number,
  tokenEnd: number,
  delta: number,
): boolean {
  const length = checkpoint.tokenEnd - checkpoint.tokenStart;
  if (length !== tokenEnd - tokenStart) {
    return false;
  }
  for (let index = 0; index < length; index++) {
    if (!tokenEqualsAfterShift(previous[checkpoint.tokenStart + index], next[tokenStart + index], delta)) {
      return false;
    }
  }
  return true;
}

// Mdast materialization visits nested spans in source order, so one cursor replaces a binary search per point.
function createForwardLocator(
  lines: readonly BlockLine[],
  sourceLength: number,
  endsInLineEnding: boolean,
): (offset: number) => SourceLocation {
  if (lines.length === 0) {
    return (offset) => {
      if (offset < 0 || offset > sourceLength) {
        throw new RangeError(`Source offset ${offset} is outside the document`);
      }
      return { line: 1, column: 1, offset };
    };
  }
  let line = 0;
  return (offset) => {
    if (offset < 0 || offset > sourceLength) {
      throw new RangeError(`Source offset ${offset} is outside the document`);
    }
    if (offset === sourceLength && endsInLineEnding) {
      return { line: lines.length + 1, column: 1, offset };
    }
    while (line + 1 < lines.length && lines[line + 1].start <= offset) {
      line++;
    }
    return { line: line + 1, column: offset - lines[line].start + 1, offset };
  };
}

function endsInLineEnding(source: string): boolean {
  const ending = source.charCodeAt(source.length - 1);
  return ending === 10 || ending === 13;
}

export class BlockScanner {
  #checkpoints: BlockCheckpoint[];
  #context: BlockScanContext;
  #lines: BlockLine[];
  #profile: BlockProfile;
  #source: string;
  #tokens: BlockToken[];

  constructor(source: string, profile: BlockProfile) {
    const context = createBlockScanContext(profile);
    const lines = linesOf(source);
    const tokens: BlockToken[] = [];
    const checkpoints: BlockCheckpoint[] = [];
    resolveLines(profile, context, source, lines, tokens, (lineStart, lineEnd, tokenStart, tokenEnd) => {
      checkpoints.push({
        lineStart: lines[lineStart].start,
        lineEnd: lines[lineEnd - 1].next,
        tokenStart,
        tokenEnd,
      });
      return false;
    });

    this.#context = context;
    this.#profile = profile;
    this.#source = source;
    this.#lines = lines;
    this.#tokens = tokens;
    this.#checkpoints = checkpoints;
  }

  get source(): string {
    return this.#source;
  }

  get tokens(): readonly BlockToken[] {
    return this.#tokens;
  }

  locator(): (offset: number) => SourceLocation {
    const lines = this.#lines;
    const sourceLength = this.#source.length;
    const trailingLineEnding = endsInLineEnding(this.#source);
    return createForwardLocator(lines, sourceLength, trailingLineEnding);
  }

  edit(nextSource: string, changedSpan: SourceSpan, oldChangedEnd: number): BlockScanChange {
    const previousSource = this.#source;
    const delta = nextSource.length - previousSource.length;

    let affected = this.#checkpoints.findIndex((checkpoint) => checkpoint.lineEnd >= changedSpan.start);
    if (affected < 0) {
      affected = Math.max(0, this.#checkpoints.length - 1);
    }
    let restart = this.#checkpoints[affected]?.lineStart > changedSpan.start ? -1 : Math.max(0, affected - 1);
    const initialRestartOffset = this.#checkpoints[restart]?.lineStart ?? 0;
    const nextLines = updatePhysicalLines(this.#lines, nextSource, initialRestartOffset, oldChangedEnd, delta);
    const profileRestart = this.#profile.restart(nextSource, nextLines, changedSpan.start, changedSpan.end);
    if (profileRestart !== void 0 && profileRestart < changedSpan.start) {
      const candidate = this.#checkpoints.findIndex((checkpoint) => (
        checkpoint.lineStart <= profileRestart &&
        checkpoint.lineEnd > profileRestart
      ));
      if (candidate >= 0) {
        restart = restart < 0 ? restart : Math.min(restart, candidate);
      }
    }
    const checkpoint = this.#checkpoints[restart];
    const restartOffset = checkpoint?.lineStart ?? 0;
    const oldTokenStart = checkpoint?.tokenStart ?? 0;
    const restartLine = nextLines.findIndex((line) => line.start >= restartOffset);
    const scanLines = restartLine < 0 ? [] : nextLines.slice(restartLine);
    const replacement: BlockToken[] = [];
    const scanned: BlockCheckpoint[] = [];
    let converged = -1;
    // Old checkpoints and rescanned blocks share source order, so candidates only move forward.
    let convergenceCandidate = affected;
    resolveLines(this.#profile, this.#context, nextSource, scanLines, replacement, (lineStart, lineEnd, tokenStart, tokenEnd) => {
      const blockStart = scanLines[lineStart].start;
      const blockEnd = scanLines[lineEnd - 1].next;
      if (blockEnd >= changedSpan.end) {
        const candidateStart = Math.max(oldChangedEnd, blockStart - delta);
        while (
          convergenceCandidate < this.#checkpoints.length &&
          this.#checkpoints[convergenceCandidate].lineStart < candidateStart
        ) {
          convergenceCandidate++;
        }
        const candidate = this.#checkpoints[convergenceCandidate];
        if (
          candidate?.lineStart + delta === blockStart &&
          candidate.lineEnd + delta === blockEnd &&
          sameShiftedBlock(this.#tokens, candidate, replacement, tokenStart, tokenEnd, delta)
        ) {
          replacement.length = tokenStart;
          converged = convergenceCandidate;
          return true;
        }
      }
      scanned.push({ lineStart: blockStart, lineEnd: blockEnd, tokenStart, tokenEnd });
      return false;
    });

    const oldTokenEnd = converged < 0 ? this.#tokens.length : this.#checkpoints[converged].tokenStart;
    const tokenDelta = replacement.length - (oldTokenEnd - oldTokenStart);
    const previousTokens = this.#tokens;
    const tokenChange = createTokenChange(
      previousTokens,
      oldTokenStart,
      oldTokenEnd,
      replacement,
      delta,
    );
    const suffix = delta === 0
      ? previousTokens.slice(oldTokenEnd)
      : previousTokens.slice(oldTokenEnd).map((token) => createShiftedToken(token, delta));
    this.#tokens = [...previousTokens.slice(0, oldTokenStart), ...replacement, ...suffix];
    const prefixCheckpoints = this.#checkpoints.slice(0, Math.max(0, restart));
    const scannedCheckpoints = scanned.map((value) => ({
      ...value,
      tokenStart: oldTokenStart + value.tokenStart,
      tokenEnd: oldTokenStart + value.tokenEnd,
    }));
    const suffixCheckpoints = converged < 0 ? [] : this.#checkpoints.slice(converged).map((value) => ({
      lineStart: value.lineStart + delta,
      lineEnd: value.lineEnd + delta,
      tokenStart: value.tokenStart + tokenDelta,
      tokenEnd: value.tokenEnd + tokenDelta,
    }));
    this.#source = nextSource;
    this.#lines = nextLines;
    this.#checkpoints = [...prefixCheckpoints, ...scannedCheckpoints, ...suffixCheckpoints];

    return {
      stableBlockCount: Math.max(0, restart),
      tokenChange,
    };
  }
}
