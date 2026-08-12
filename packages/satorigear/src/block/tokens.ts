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
  #fields: number[] = [];
  #metadata: (BlockTokenMeta | undefined)[] = [];
  #relativeStart = Number.POSITIVE_INFINITY;
  #sourceLength: number;

  constructor(sourceLength = 0) {
    this.#sourceLength = sourceLength;
  }

  get length(): number {
    return this.#fields.length / blockTokenStride;
  }

  push(kind: BlockKind, start: number, end: number, meta?: BlockTokenMeta): void {
    this.#fields.push(kind, start, end, 0);
    this.#metadata.push(meta);
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
    const ranges = this.#metadata[index]?.rangeOffsets;
    const nextRanges = next.#metadata[nextIndex]?.rangeOffsets;
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
    const text = this.#metadata[index]?.text;
    const nextText = next.#metadata[nextIndex]?.text;
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

  kind(index: number): BlockKind {
    return this.#fields[index * blockTokenStride] as BlockKind;
  }

  rangeCount(index: number): number {
    return (this.#metadata[index]?.rangeOffsets?.length ?? 2) / 2;
  }

  rangeEnd(index: number, range: number): number {
    const offsets = this.#metadata[index]?.rangeOffsets;
    return offsets ? this.start(index) + offsets[range * 2 + 1] : this.end(index);
  }

  rangeStart(index: number, range: number): number {
    return this.start(index) + (this.#metadata[index]?.rangeOffsets?.[range * 2] ?? 0);
  }

  replace(
    source: string,
    nextSource: string,
    start: number,
    end: number,
    replacement: BlockTokenStream,
  ): BlockTokenChange {
    const oldLength = this.length;
    const inserted = replacement.length;
    const suffixStart = start + inserted;
    const delta = nextSource.length - source.length;
    const common = Math.min(end - start, inserted);
    let unchangedPrefix = 0;
    while (
      unchangedPrefix < common &&
      this.equalsAfterShift(start + unchangedPrefix, source, replacement, unchangedPrefix, nextSource, 0)
    ) {
      unchangedPrefix++;
    }
    let unchangedSuffix = 0;
    while (
      unchangedSuffix < common - unchangedPrefix &&
      this.equalsAfterShift(
        end - 1 - unchangedSuffix,
        source,
        replacement,
        inserted - 1 - unchangedSuffix,
        nextSource,
        delta,
      )
    ) {
      unchangedSuffix++;
    }
    const change = {
      oldStart: start + unchangedPrefix,
      oldEnd: end - unchangedSuffix,
      newEnd: start + inserted - unchangedSuffix,
    };

    // Positions before the edit stay absolute; stable suffix positions stay EOF-relative.
    // Updating sourceLength below then rebases the whole suffix without walking it.
    if (this.#relativeStart < end) {
      for (let index = this.#relativeStart; index < end; index++) {
        const field = index * blockTokenStride;
        this.#fields[field + 1] += this.#sourceLength + 1;
        this.#fields[field + 2] += this.#sourceLength + 1;
      }
    }
    else if (this.#relativeStart > end) {
      const relativeEnd = Math.min(this.#relativeStart, oldLength);
      for (let index = end; index < relativeEnd; index++) {
        const field = index * blockTokenStride;
        this.#fields[field + 1] -= this.#sourceLength + 1;
        this.#fields[field + 2] -= this.#sourceLength + 1;
      }
    }
    const replacementMetadata = replacement.#metadata;
    // Tail edits retain the existing buffers and their capacity. A middle edit needs
    // fresh dense arrays so shifting a longer replacement cannot make them holey.
    if (end === oldLength) {
      this.#fields.length = start * blockTokenStride;
      for (let index = 0; index < replacement.#fields.length; index++) {
        this.#fields.push(replacement.#fields[index]);
      }
      this.#metadata.length = start;
      for (let index = 0; index < inserted; index++) {
        this.#metadata.push(replacementMetadata[index]);
      }
    }
    else {
      this.#fields = this.#fields.slice(0, start * blockTokenStride).concat(
        replacement.#fields,
        this.#fields.slice(end * blockTokenStride),
      );
      this.#metadata = this.#metadata.slice(0, start).concat(
        replacementMetadata,
        this.#metadata.slice(end, oldLength),
      );
    }
    this.#relativeStart = suffixStart < this.length ? suffixStart : Number.POSITIVE_INFINITY;
    this.#sourceLength = nextSource.length;
    return change;
  }

  start(index: number): number {
    return this.#position(this.#fields[index * blockTokenStride + 1]);
  }

  end(index: number): number {
    return this.#position(this.#fields[index * blockTokenStride + 2]);
  }

  text(source: string, index: number): string {
    return this.#metadata[index]?.text ?? source.slice(this.start(index), this.end(index));
  }

  truncate(length: number): void {
    this.#fields.length = length * blockTokenStride;
    this.#metadata.length = length;
  }

  value<T>(index: number): T | undefined {
    return this.#metadata[index]?.value as T | undefined;
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
