import { type BlockLine, indentOf, isBlank, lineIndent } from "./primitives.ts";
import {
  type BlockToken,
  type BlockTokenChange,
  createShiftedToken,
  createTokenChange,
  tokenEqualsAfterShift,
} from "./tokens.ts";
import type { BlockScanContext, SyntaxProfile } from "../profile/types.ts";
import type { SourceLocation } from "../source-view.ts";
import type { TextEdit } from "../text-edit.ts";

function linesOf(source: string): BlockLine[] {
  const lines: BlockLine[] = [];
  let start = 0;
  while (start < source.length) {
    let end = start;
    while (end < source.length && source[end] !== "\n" && source[end] !== "\r") {
      end++;
    }
    let next = end;
    if (source[next] === "\r") {
      next += source[next + 1] === "\n" ? 2 : 1;
    }
    else if (source[next] === "\n") {
      next++;
    }
    lines.push({ start, end, next });
    start = next;
  }
  return lines;
}

function profileStarts(
  profile: SyntaxProfile,
  context: BlockScanContext,
  source: string,
  lines: readonly BlockLine[],
  start: number,
  out: BlockToken[],
): number | undefined {
  const indent = lineIndent(source, lines[start]);
  if (!indent) {
    return void 0;
  }
  const starts = profile.blockStarts[source.charCodeAt(indent.offset)];
  if (!starts) {
    return void 0;
  }
  if (typeof starts === "function") {
    return starts(source, lines, start, out, indent.offset, context);
  }
  for (const resolve of starts) {
    const end = resolve(source, lines, start, out, indent.offset, context);
    if (end !== void 0) {
      return end;
    }
  }
  return void 0;
}

function startsInterruptingBlock(profile: SyntaxProfile, source: string, line: BlockLine): boolean {
  const indent = lineIndent(source, line);
  if (!indent) {
    return false;
  }
  const interrupts = profile.blockInterrupts[source.charCodeAt(indent.offset)];
  if (!interrupts) {
    return false;
  }
  if (typeof interrupts === "function") {
    return interrupts(source, line, indent.offset);
  }
  for (const interrupt of interrupts) {
    if (interrupt(source, line, indent.offset)) {
      return true;
    }
  }
  return false;
}

function startsParagraphAt(context: BlockScanContext, source: string, line: BlockLine): boolean {
  return !isBlank(source, line)
    && !context.startsInterruptingBlock(source, line)
    && indentOf(source, line).columns < 4;
}

function endsWithParagraphLeaf(
  profile: SyntaxProfile,
  context: BlockScanContext,
  source: string,
  line: BlockLine,
): boolean {
  let contentLine = line;
  for (;;) {
    let unwrapped: BlockLine | undefined;
    for (const unwrap of profile.blockUnwrappers) {
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
  profile: SyntaxProfile,
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
  for (const fallback of profile.blockFallbacks) {
    const fallbackEnd = fallback(source, lines, start, out, lines[start].start, context);
    if (fallbackEnd !== void 0) {
      return fallbackEnd;
    }
  }
  throw new Error("Syntax profile did not provide a block fallback");
}

type BlockVisitor = (lineStart: number, lineEnd: number, tokenStart: number, tokenEnd: number) => boolean;

interface BlockCheckpoint {
  lineEnd: number;
  lineStart: number;
  tokenEnd: number;
  tokenStart: number;
}

interface BlockEditResult {
  change: BlockTokenChange;
  scannedRange: {
    end: number;
    start: number;
  };
}

function resolveLines(
  profile: SyntaxProfile,
  context: BlockScanContext,
  source: string,
  lines: readonly BlockLine[],
  out: BlockToken[],
  visit?: BlockVisitor,
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

function createBlockScanContext(profile: SyntaxProfile): BlockScanContext {
  const context: BlockScanContext = {
    endsWithParagraphLeaf: (source, line) => endsWithParagraphLeaf(profile, context, source, line),
    startsInterruptingBlock: (source, line) => startsInterruptingBlock(profile, source, line),
    resolveLines: (source, lines, tokens) => resolveLines(profile, context, source, lines, tokens),
  };
  return context;
}

function scanBlocks(
  profile: SyntaxProfile,
  context: BlockScanContext,
  source: string,
): { checkpoints: BlockCheckpoint[]; lines: BlockLine[]; tokens: BlockToken[] } {
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
  return { checkpoints, lines, tokens };
}

function applyBlockEdits(source: string, edits: readonly TextEdit[]): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const [index, edit] of edits.entries()) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)
      || edit.start < cursor || edit.start > edit.end || edit.end > source.length) {
      throw new RangeError(`Invalid block edit #${index}: [${edit.start}, ${edit.end})`);
    }
    parts.push(source.slice(cursor, edit.start), edit.text);
    cursor = edit.end;
  }
  parts.push(source.slice(cursor));
  return parts.join("");
}

function shiftedLine(line: BlockLine, delta: number): BlockLine {
  return { start: line.start + delta, end: line.end + delta, next: line.next + delta };
}

function shiftedLines(source: string, offset: number): BlockLine[] {
  return linesOf(source).map((line) => shiftedLine(line, offset));
}

function updatePhysicalLines(
  previous: readonly BlockLine[],
  nextSource: string,
  restartOffset: number,
  oldDamageEnd: number,
  delta: number,
): BlockLine[] {
  let suffix = previous.findIndex((line) => line.start > oldDamageEnd);
  if (suffix >= 0) {
    suffix = Math.min(previous.length, suffix + 1);
  }
  else {
    suffix = previous.length;
  }
  const oldSuffixOffset = previous[suffix]?.start ?? nextSource.length - delta;
  const newSuffixOffset = oldSuffixOffset + delta;
  const prefix = previous.filter((line) => line.start < restartOffset);
  const changed = shiftedLines(nextSource.slice(restartOffset, newSuffixOffset), restartOffset);
  const unchanged = previous.slice(suffix).map((line) => shiftedLine(line, delta));
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
  #profile: SyntaxProfile;
  #source: string;
  #tokens: BlockToken[];

  constructor(source: string, profile: SyntaxProfile) {
    const context = createBlockScanContext(profile);
    const initial = scanBlocks(profile, context, source);
    this.#context = context;
    this.#profile = profile;
    this.#source = source;
    this.#lines = initial.lines;
    this.#tokens = initial.tokens;
    this.#checkpoints = initial.checkpoints;
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

  edit(edits: readonly TextEdit[]): BlockEditResult {
    if (edits.length === 0) {
      return { change: { oldStart: 0, oldEnd: 0, tokens: [] }, scannedRange: { start: 0, end: 0 } };
    }
    const previousSource = this.#source;
    const nextSource = applyBlockEdits(previousSource, edits);
    const firstEdit = edits[0];
    const lastEdit = edits.at(-1)!;
    const delta = nextSource.length - previousSource.length;
    let changedEnd = firstEdit.start;
    let precedingDelta = 0;
    for (const edit of edits) {
      changedEnd = edit.start + precedingDelta + edit.text.length;
      precedingDelta += edit.text.length - (edit.end - edit.start);
    }

    let affected = this.#checkpoints.findIndex((checkpoint) => checkpoint.lineEnd >= firstEdit.start);
    if (affected < 0) {
      affected = Math.max(0, this.#checkpoints.length - 1);
    }
    let restart = this.#checkpoints[affected]?.lineStart > firstEdit.start ? -1 : Math.max(0, affected - 1);
    const initialRestartOffset = this.#checkpoints[restart]?.lineStart ?? 0;
    const nextLines = updatePhysicalLines(this.#lines, nextSource, initialRestartOffset, lastEdit.end, delta);
    const profileRestart = this.#profile.blockRestart(nextSource, nextLines, changedEnd);
    if (profileRestart !== void 0 && profileRestart < firstEdit.start) {
      const candidate = this.#checkpoints.findIndex((checkpoint) => checkpoint.lineStart <= profileRestart
        && checkpoint.lineEnd > profileRestart);
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
    let scannedEnd = nextSource.length;
    resolveLines(this.#profile, this.#context, nextSource, scanLines, replacement, (lineStart, lineEnd, tokenStart, tokenEnd) => {
      const blockStart = scanLines[lineStart].start;
      const blockEnd = scanLines[lineEnd - 1].next;
      if (blockEnd >= changedEnd) {
        const candidate = this.#checkpoints.findIndex((old) => old.lineStart + delta === blockStart
          && old.lineEnd + delta === blockEnd
          && old.lineStart >= lastEdit.end);
        if (candidate >= 0 && sameShiftedBlock(this.#tokens, this.#checkpoints[candidate], replacement, tokenStart, tokenEnd, delta)) {
          replacement.length = tokenStart;
          converged = candidate;
          scannedEnd = blockEnd;
          return true;
        }
      }
      scanned.push({ lineStart: blockStart, lineEnd: blockEnd, tokenStart, tokenEnd });
      return false;
    });

    const oldTokenEnd = converged < 0 ? this.#tokens.length : this.#checkpoints[converged].tokenStart;
    const tokenDelta = replacement.length - (oldTokenEnd - oldTokenStart);
    const previousTokens = this.#tokens;
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
      change: createTokenChange(previousTokens, this.#tokens, delta),
      scannedRange: { start: restartOffset, end: scannedEnd },
    };
  }
}
