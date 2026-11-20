import { BlockKind, boundaryBreak } from "./constants/block.ts";
import type { BlockTokenStream } from "./block/tokens.ts";
import type { InlineTokenizer } from "./inline/tokenizer.ts";
import type { InlineTokenStream } from "./inline/tokens.ts";

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

export function cloneLocation(location: SourceLocation): SourceLocation {
  return {
    line: location.line,
    column: location.column,
    offset: location.offset,
  };
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
  // Contiguous views store one offset, segmented views store offset/end pairs.
  #projection: number | number[] = 0;
  #withBoundaryBreak = false;
  text = "";

  /** Projects the consecutive inline chunks owned by a block token. */
  reset(source: string, tokens: BlockTokenStream, tokenStart: number, nodeLength: number): void {
    this.#withBoundaryBreak = tokens.value(tokenStart) === boundaryBreak;
    let token = tokenStart + 1;
    const firstStart = tokens.start(token);
    const tokenEnd = tokenStart + nodeLength;
    let end = tokens.end(token++);
    if (token < tokenEnd && tokens.kind(token) === BlockKind.InlineChunk) {
      const parts = [source.slice(firstStart, end)];
      let viewEnd = end - firstStart;
      const segments = [firstStart, viewEnd];
      do {
        const start = tokens.start(token);
        end = tokens.end(token++);
        parts.push(source.slice(start, end));
        segments.push(start - viewEnd, viewEnd += end - start);
      }
      while (token < tokenEnd && tokens.kind(token) === BlockKind.InlineChunk);
      this.#projection = segments;
      this.text = parts.join("");
      return;
    }
    this.#projection = firstStart;
    this.text = source.slice(firstStart, end);
  }

  tokenize(tokenize: InlineTokenizer, scratch = false): InlineTokenStream {
    return tokenize(
      this.text,
      this.#withBoundaryBreak,
      !scratch || typeof this.#projection !== "number" || this.#withBoundaryBreak
        ? void 0
        : this.#projection,
    );
  }

  /** Maps an offset at an internal gap to the following source segment. */
  mapOffset(offset: number): number {
    const segments = this.#projection;
    if (typeof segments === "number") {
      return segments + offset;
    }
    if (offset === this.text.length) {
      return segments[segments.length - 2] + offset;
    }
    const segment = containingSegment(segments, offset);
    return segments[segment] + offset;
  }

  /** Maps an exclusive end at an internal gap to the preceding source segment. */
  mapEnd(offset: number): number {
    const segments = this.#projection;
    if (typeof segments === "number") {
      return segments + offset;
    }
    const segment = containingSegment(segments, Math.max(0, offset - 1));
    return segments[segment] + offset;
  }

  shift(delta: number): void {
    const segments = this.#projection;
    if (typeof segments === "number") {
      this.#projection = segments + delta;
      return;
    }
    for (let index = 0; index < segments.length; index += 2) {
      segments[index] += delta;
    }
  }
}
