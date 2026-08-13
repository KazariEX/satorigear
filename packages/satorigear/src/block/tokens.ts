import { type BlockLine, logicalLine } from "./lines.ts";
import type { BlockKind } from "./kinds.ts";

// The fourth slot is reserved for flags. Besides matching inline token records,
// the power-of-two stride is measurably faster in V8 than packing only three fields.
const blockTokenStride = 4;

interface BlockTokenMeta {
  rangeOffsets?: readonly number[];
  text?: string;
  value?: unknown;
}

export interface BlockTokenChange {
  newEnd: number;
  oldEnd: number;
  oldStart: number;
}

export class BlockTokenStream {
  #fields: number[];
  #metadata: Map<number, BlockTokenMeta> | undefined;
  #relativeStart: number;
  #sourceLength: number;

  constructor(sourceLength = 0) {
    this.#fields = [];
    this.#relativeStart = Number.POSITIVE_INFINITY;
    this.#sourceLength = sourceLength;
  }

  reset(sourceLength: number): void {
    this.#fields.length = 0;
    this.#metadata = void 0;
    this.#relativeStart = Number.POSITIVE_INFINITY;
    this.#sourceLength = sourceLength;
  }

  get length(): number {
    return this.#fields.length / blockTokenStride;
  }

  push(kind: BlockKind, start: number, end: number, meta?: BlockTokenMeta): void {
    this.#fields.push(kind, start, end, 0);
    if (meta) {
      this.#metadata ??= new Map();
      this.#metadata.set(this.length - 1, meta);
    }
  }

  equalsAfterShift(
    index: number,
    source: string,
    next: BlockTokenStream,
    nextIndex: number,
    nextSource: string,
    delta: number,
  ): boolean {
    if (
      this.kind(index) !== next.kind(nextIndex) ||
      this.start(index) + delta !== next.start(nextIndex) ||
      this.end(index) + delta !== next.end(nextIndex)
    ) {
      return false;
    }
    const ranges = this.#metadata?.get(index)?.rangeOffsets;
    const nextRanges = next.#metadata?.get(nextIndex)?.rangeOffsets;
    if ((ranges?.length ?? 0) !== (nextRanges?.length ?? 0)) {
      return false;
    }
    if (ranges && nextRanges) {
      for (let range = 0; range < ranges.length; range++) {
        if (ranges[range] !== nextRanges[range]) {
          return false;
        }
      }
    }
    const text = this.#metadata?.get(index)?.text;
    const nextText = next.#metadata?.get(nextIndex)?.text;
    if (text !== void 0 || nextText !== void 0) {
      return text === nextText;
    }
    return equalSourceText(
      source,
      this.start(index),
      this.end(index),
      nextSource,
      next.start(nextIndex),
      next.end(nextIndex),
    );
  }

  rangeCount(index: number): number {
    return (this.#metadata?.get(index)?.rangeOffsets?.length ?? 2) / 2;
  }

  rangeEnd(index: number, range: number): number {
    const offsets = this.#metadata?.get(index)?.rangeOffsets;
    return offsets ? this.start(index) + offsets[range * 2 + 1] : this.end(index);
  }

  rangeStart(index: number, range: number): number {
    return this.start(index) + (
      this.#metadata?.get(index)?.rangeOffsets?.[range * 2] ?? 0
    );
  }

  replace(
    source: string,
    nextSource: string,
    start: number,
    end: number,
    replacement: BlockTokenStream,
  ): BlockTokenChange {
    const previousLength = this.length;
    const replacedLength = end - start;
    const replacementLength = replacement.length;
    const sourceDelta = nextSource.length - source.length;

    // 1. Narrow the reported damage to the tokens that actually changed.
    const overlapLength = Math.min(replacedLength, replacementLength);
    let stablePrefixLength = 0;
    while (
      stablePrefixLength < overlapLength &&
      this.equalsAfterShift(start + stablePrefixLength, source, replacement, stablePrefixLength, nextSource, 0)
    ) {
      stablePrefixLength++;
    }
    let stableSuffixLength = 0;
    while (
      stableSuffixLength < overlapLength - stablePrefixLength &&
      this.equalsAfterShift(
        end - 1 - stableSuffixLength,
        source,
        replacement,
        replacementLength - 1 - stableSuffixLength,
        nextSource,
        sourceDelta,
      )
    ) {
      stableSuffixLength++;
    }
    const change = {
      oldStart: start + stablePrefixLength,
      oldEnd: end - stableSuffixLength,
      newEnd: start + replacementLength - stableSuffixLength,
    };

    // 2. Align coordinate encoding with the replacement boundary. Positions before it
    // stay absolute; the retained suffix becomes EOF-relative so sourceLength rebases it.
    if (this.#relativeStart < end) {
      for (let index = this.#relativeStart; index < end; index++) {
        const field = index * blockTokenStride;
        this.#fields[field + 1] += this.#sourceLength + 1;
        this.#fields[field + 2] += this.#sourceLength + 1;
      }
    }
    else if (this.#relativeStart > end) {
      const relativeEnd = Math.min(this.#relativeStart, previousLength);
      for (let index = end; index < relativeEnd; index++) {
        const field = index * blockTokenStride;
        this.#fields[field + 1] -= this.#sourceLength + 1;
        this.#fields[field + 2] -= this.#sourceLength + 1;
      }
    }

    // 3. Replace the packed fields in place whenever their count is stable. Only a size-changing
    // middle edit needs a fresh dense array so a longer replacement cannot make it holey.
    if (end === previousLength) {
      this.#fields.length = start * blockTokenStride;
      for (let index = 0; index < replacement.#fields.length; index++) {
        this.#fields.push(replacement.#fields[index]);
      }
    }
    else if (replacementLength === replacedLength) {
      const fieldStart = start * blockTokenStride;
      for (let index = 0; index < replacement.#fields.length; index++) {
        this.#fields[fieldStart + index] = replacement.#fields[index];
      }
    }
    else {
      this.#fields = this.#fields.slice(0, start * blockTokenStride).concat(
        replacement.#fields,
        this.#fields.slice(end * blockTokenStride),
      );
    }

    // 4. Splice sparse metadata. Stable indexes update in place; a size-changing
    // middle replacement shifts suffix keys into a new map.
    const indexDelta = replacementLength - replacedLength;
    if (end === previousLength || indexDelta === 0) {
      if (this.#metadata) {
        for (const index of this.#metadata.keys()) {
          if (index >= start && index < end) {
            this.#metadata.delete(index);
          }
        }
      }
      if (replacement.#metadata) {
        const metadata = this.#metadata ??= new Map();
        for (const [index, value] of replacement.#metadata) {
          metadata.set(start + index, value);
        }
      }
      if (this.#metadata?.size === 0) {
        this.#metadata = void 0;
      }
    }
    else {
      const metadata = new Map<number, BlockTokenMeta>();
      for (const [index, value] of this.#metadata ?? []) {
        if (index < start) {
          metadata.set(index, value);
        }
        else if (index >= end) {
          metadata.set(index + indexDelta, value);
        }
      }
      for (const [index, value] of replacement.#metadata ?? []) {
        metadata.set(start + index, value);
      }
      this.#metadata = metadata.size > 0 ? metadata : void 0;
    }

    const newSuffixStart = start + replacementLength;
    this.#relativeStart = newSuffixStart < this.length ? newSuffixStart : Number.POSITIVE_INFINITY;
    this.#sourceLength = nextSource.length;
    return change;
  }

  truncate(length: number): void {
    this.#fields.length = length * blockTokenStride;
    if (this.#metadata) {
      for (const index of this.#metadata.keys()) {
        if (index >= length) {
          this.#metadata.delete(index);
        }
      }
      if (this.#metadata.size === 0) {
        this.#metadata = void 0;
      }
    }
  }

  kind(index: number): BlockKind {
    return this.#fields[index * blockTokenStride] as BlockKind;
  }

  start(index: number): number {
    return this.#position(this.#fields[index * blockTokenStride + 1]);
  }

  end(index: number): number {
    return this.#position(this.#fields[index * blockTokenStride + 2]);
  }

  text(source: string, index: number): string {
    return this.#metadata?.get(index)?.text ?? source.slice(this.start(index), this.end(index));
  }

  value<T>(index: number): T | undefined {
    return this.#metadata?.get(index)?.value as T | undefined;
  }

  #position(position: number): number {
    return position < 0 ? position + this.#sourceLength + 1 : position;
  }
}

export function appendLogicalToken(
  out: BlockTokenStream,
  kind: BlockKind,
  source: string,
  lines: readonly BlockLine[],
  start: number,
  end: number,
  value?: unknown,
): void {
  const count = end - start;
  const tokenStart = lines[start].start;
  const rangeOffsets = new Array<number>(count * 2);
  let canSliceSource = true;
  let previousLineEnd = 0;
  for (let index = 0; index < count; index++) {
    const line = lines[start + index];
    // Ranges retain the physical source spans even when the token text needs logical indentation repair.
    rangeOffsets[index * 2] = line.start - tokenStart;
    rangeOffsets[index * 2 + 1] = line.next - tokenStart;

    canSliceSource &&= (
      // Tab overshoot is represented as virtual leading columns that do not exist in the source slice.
      (line.prefixColumns ?? 0) === 0 &&
      // A derived line may begin inside its physical line after a container marker was stripped.
      (line.start === 0 || source[line.start - 1] === "\n" || source[line.start - 1] === "\r") &&
      // Adjacent physical spans are required so a single slice cannot restore skipped container prefixes.
      (index === 0 || line.start === previousLineEnd)
    );
    previousLineEnd = line.next;
  }

  let text: string | undefined;
  if (!canSliceSource) {
    const logicalLines = new Array<string>(count);
    for (let index = 0; index < count; index++) {
      logicalLines[index] = logicalLine(source, lines[start + index]);
    }
    text = logicalLines.join("");
  }
  out.push(
    kind,
    lines[start].start,
    lines[end - 1].next,
    { rangeOffsets, text, value },
  );
}

function equalSourceText(
  previousSource: string,
  previousStart: number,
  previousEnd: number,
  nextSource: string,
  nextStart: number,
  nextEnd: number,
): boolean {
  return (
    previousEnd - previousStart === nextEnd - nextStart &&
    previousSource.slice(previousStart, previousEnd) === nextSource.slice(nextStart, nextEnd)
  );
}
