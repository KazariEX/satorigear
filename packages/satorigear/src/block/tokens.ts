import { emptyArray, isArrayEqual } from "../primitives.ts";
import { type BlockLine, logicalLine } from "./lines.ts";
import { BlockSyntaxKind } from "./profile.ts";
import type { BlockKind } from "../constants/block.ts";
import type { BlockSyntaxSchema } from "./profile.ts";

// The fourth slot stores the token length of a semantic node beginning here. Raw tokens use zero.
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
  #fieldLength: number;
  #fields: Int32Array;
  #metadata: Map<number, BlockTokenMeta> | undefined;
  #relativeStart: number;
  #sourceLength: number;

  constructor(sourceLength = 0) {
    this.#fieldLength = 0;
    this.#fields = new Int32Array();
    this.#relativeStart = Number.POSITIVE_INFINITY;
    this.#sourceLength = sourceLength;
  }

  reset(sourceLength: number): void {
    this.#fieldLength = 0;
    this.#metadata = void 0;
    this.#relativeStart = Number.POSITIVE_INFINITY;
    this.#sourceLength = sourceLength;
  }

  get length(): number {
    return this.#fieldLength / blockTokenStride;
  }

  push(kind: BlockKind, start: number, end: number, meta?: BlockTokenMeta): void {
    const field = this.#fieldLength;
    this.#ensureCapacity(field + blockTokenStride);
    this.#fields[field] = kind;
    this.#fields[field + 1] = start;
    this.#fields[field + 2] = end;
    this.#fields[field + 3] = 0;
    this.#fieldLength += blockTokenStride;
    if (meta) {
      this.#metadata ??= new Map();
      this.#metadata.set(this.length - 1, meta);
    }
  }

  indexStructure(schema: BlockSyntaxSchema): void {
    const fields = this.#fields;
    const opens: number[] = [];
    const closes: BlockKind[] = [];
    // Scanning writes each token once with an empty node length, so indexing needs no clearing pass.
    for (let index = 0; index < this.length; index++) {
      const kind = this.kind(index);
      const rule = schema.ruleByKind[kind];
      if (rule?.syntaxKind === BlockSyntaxKind.Frame) {
        opens.push(index);
        closes.push(rule.close);
        continue;
      }
      if (rule?.syntaxKind === BlockSyntaxKind.Group) {
        const start = index;
        do {
          index++;
        } while (
          index < this.length &&
          schema.ruleByKind[this.kind(index)] === rule
        );
        fields[start * blockTokenStride + 3] = index - start;
        index--;
        continue;
      }
      if (closes.at(-1) === kind) {
        const open = opens.pop()!;
        closes.pop();
        fields[open * blockTokenStride + 3] = index - open + 1;
        continue;
      }
      if (rule?.syntaxKind === BlockSyntaxKind.Leaf) {
        fields[index * blockTokenStride + 3] = 1;
      }
    }
    if (opens.length > 0) {
      throw new Error(`Block token stream did not close token ${this.kind(opens.at(-1)!)}`);
    }
  }

  nodeLength(index: number): number {
    return this.#fields[index * blockTokenStride + 3];
  }

  equalsAfterShift(
    index: number,
    source: string,
    next: BlockTokenStream,
    nextIndex: number,
    nextSource: string,
    delta: number,
  ): boolean {
    const start = this.start(index);
    const end = this.end(index);
    const nextStart = next.start(nextIndex);
    const nextEnd = next.end(nextIndex);
    if (
      this.kind(index) !== next.kind(nextIndex) ||
      start + delta !== nextStart ||
      end + delta !== nextEnd
    ) {
      return false;
    }
    const ranges = this.#metadata?.get(index)?.rangeOffsets;
    const nextRanges = next.#metadata?.get(nextIndex)?.rangeOffsets;
    if (ranges !== nextRanges && !isArrayEqual(ranges ?? emptyArray, nextRanges ?? emptyArray)) {
      return false;
    }
    const text = this.#metadata?.get(index)?.text;
    const nextText = next.#metadata?.get(nextIndex)?.text;
    if (text !== void 0 || nextText !== void 0) {
      return text === nextText;
    }
    return (
      end - start === nextEnd - nextStart &&
      source.slice(start, end) === nextSource.slice(nextStart, nextEnd)
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

    // 3. Replace packed fields in place. A size-changing middle edit shifts the suffix,
    // growing the dense backing store only when its retained capacity is insufficient.
    if (end === previousLength) {
      const fieldStart = start * blockTokenStride;
      const fieldEnd = fieldStart + replacement.#fieldLength;
      this.#ensureCapacity(fieldEnd);
      this.#fields.set(replacement.#fields.subarray(0, replacement.#fieldLength), fieldStart);
      this.#fieldLength = fieldEnd;
    }
    else if (replacementLength === replacedLength) {
      const fieldStart = start * blockTokenStride;
      this.#fields.set(replacement.#fields.subarray(0, replacement.#fieldLength), fieldStart);
    }
    else {
      const fieldStart = start * blockTokenStride;
      const oldFieldEnd = end * blockTokenStride;
      const newFieldEnd = fieldStart + replacement.#fieldLength;
      const nextFieldLength = this.#fieldLength + newFieldEnd - oldFieldEnd;
      this.#ensureCapacity(nextFieldLength);
      this.#fields.copyWithin(newFieldEnd, oldFieldEnd, this.#fieldLength);
      this.#fields.set(replacement.#fields.subarray(0, replacement.#fieldLength), fieldStart);
      this.#fieldLength = nextFieldLength;
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
    this.#fieldLength = length * blockTokenStride;
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

  setKind(index: number, kind: BlockKind): void {
    this.#fields[index * blockTokenStride] = kind;
  }

  start(index: number): number {
    return this.#position(this.#fields[index * blockTokenStride + 1]);
  }

  setStart(index: number, start: number): void {
    this.#fields[index * blockTokenStride + 1] = start;
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

  #ensureCapacity(length: number): void {
    if (length <= this.#fields.length) {
      return;
    }
    let capacity = Math.max(64, this.#fields.length * 2);
    while (capacity < length) {
      capacity *= 2;
    }
    const fields = new Int32Array(capacity);
    fields.set(this.#fields.subarray(0, this.#fieldLength));
    this.#fields = fields;
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
