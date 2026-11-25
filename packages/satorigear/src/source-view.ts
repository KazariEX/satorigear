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

function containingSegment(mappings: number[], offset: number): number {
  let low = 0;
  let high = (mappings.length >>> 1) - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (offset < mappings[middle * 2 + 1]) {
      high = middle;
    }
    else {
      low = middle + 1;
    }
  }
  return low * 2;
}

export class SourceView {
  #mappings: number | number[] = 0;
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
      const mappings = [firstStart, viewEnd];
      do {
        const start = tokens.start(token);
        end = tokens.end(token++);
        parts.push(source.slice(start, end));
        mappings.push(start - viewEnd, viewEnd += end - start);
      }
      while (token < tokenEnd && tokens.kind(token) === BlockKind.InlineChunk);
      this.#mappings = mappings;
      this.text = parts.join("");
      return;
    }
    this.#mappings = firstStart;
    this.text = source.slice(firstStart, end);
  }

  tokenize(tokenize: InlineTokenizer, scratch = false): InlineTokenStream {
    return tokenize(
      this.text,
      this.#withBoundaryBreak,
      !scratch || typeof this.#mappings !== "number" || this.#withBoundaryBreak
        ? void 0
        : this.#mappings,
    );
  }

  /** Maps an offset at an internal gap to the following source mapping. */
  mapOffset(offset: number): number {
    const mappings = this.#mappings;
    if (typeof mappings === "number") {
      return mappings + offset;
    }
    const index = containingSegment(mappings, offset);
    return mappings[index] + offset;
  }

  /** Maps an exclusive end at an internal gap to the preceding source mapping. */
  mapEnd(offset: number): number {
    const mappings = this.#mappings;
    if (typeof mappings === "number") {
      return mappings + offset;
    }
    const index = containingSegment(mappings, Math.max(0, offset - 1));
    return mappings[index] + offset;
  }

  shift(delta: number): void {
    const mappings = this.#mappings;
    if (typeof mappings === "number") {
      this.#mappings = mappings + delta;
      return;
    }
    for (let index = 0; index < mappings.length; index += 2) {
      mappings[index] += delta;
    }
  }
}
