import { BlockKind } from "./constants/block.ts";
import type { BlockTokenStream } from "./block/tokens.ts";

export interface SourceLocation {
  line: number;
  column: number;
  offset: number;
}

export interface SourcePosition {
  end: SourceLocation;
  start: SourceLocation;
}

export interface SourceSpan {
  end: number;
  start: number;
}

export interface SourceLocator {
  normalizeLineEndings: (value: string) => string;
  locationAt: (offset: number) => SourceLocation;
  positionAt: (start: number, end: number) => SourcePosition;
}

function containingSegment(segments: number[], offset: number): number {
  let low = 0;
  let high = segments.length >>> 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (offset < segments[middle * 2 + 1]) {
      high = middle;
    }
    else {
      low = middle + 1;
    }
  }
  return low * 2;
}

export class SourceView {
  #offset = 0;
  // Segmented views store sourceStart - viewStart and cumulative view end pairs;
  // contiguous views need only the offset above.
  readonly #segments: number[] | undefined;
  readonly text: string;

  /** Projects the consecutive inline chunks owned by a block token. */
  constructor(
    source: string,
    tokens: BlockTokenStream,
    tokenStart: number,
    nodeLength: number,
  ) {
    let token = tokenStart + 1;
    const firstStart = tokens.start(token);
    const tokenEnd = tokenStart + nodeLength;
    let segmentStart = firstStart;
    let end = tokens.end(token++);
    let parts: string[] | undefined;
    let segments: number[] | undefined;
    let viewEnd = 0;
    while (token < tokenEnd && tokens.kind(token) === BlockKind.InlineChunk) {
      const start = tokens.start(token);
      // Physically adjacent chunks still form one source slice; only stripped container gaps need segments.
      if (start !== end) {
        (parts ??= []).push(source.slice(segmentStart, end));
        (segments ??= []).push(segmentStart - viewEnd, viewEnd += end - segmentStart);
        segmentStart = start;
      }
      end = tokens.end(token);
      token++;
    }
    if (parts && segments) {
      parts.push(source.slice(segmentStart, end));
      segments.push(segmentStart - viewEnd, viewEnd + end - segmentStart);
      this.#segments = segments;
      this.text = parts.join("");
      return;
    }
    this.#offset = firstStart;
    this.text = source.slice(firstStart, end);
  }

  /** Maps an offset at an internal gap to the following source segment. */
  mapOffset(offset: number): number {
    const segments = this.#segments;
    if (!segments) {
      return this.#offset + offset;
    }
    if (offset === this.text.length) {
      return segments[segments.length - 2] + offset;
    }
    const segment = containingSegment(segments, offset);
    return segments[segment] + offset;
  }

  /** Maps an exclusive end at an internal gap to the preceding source segment. */
  mapEnd(offset: number): number {
    const segments = this.#segments;
    if (!segments) {
      return this.#offset + offset;
    }
    const segment = containingSegment(segments, Math.max(0, offset - 1));
    return segments[segment] + offset;
  }

  shift(delta: number): void {
    const segments = this.#segments;
    if (!segments) {
      this.#offset += delta;
      return;
    }
    for (let index = 0; index < segments.length; index += 2) {
      segments[index] += delta;
    }
  }
}
