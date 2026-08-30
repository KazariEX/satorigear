import { type BlockKind, BlockTokenRole } from "../constants/block.ts";
import { Character } from "../constants/character.ts";
import { emptySet } from "../primitives.ts";
import { type BlockLines, logicalLine } from "./lines.ts";

const enum BlockTokenField {
  Kind,
  Start,
  End,
  Length,
  Stride,
}

interface BlockTokenMeta {
  definitionKey?: string;
  text?: string;
  value?: unknown;
}

export interface BlockTokenChange {
  // Borrowed until reset() or the next replace(); contains exactly the keys whose membership changed.
  definitionMembershipChanges: ReadonlySet<string>;
  newEnd: number;
  oldEnd: number;
  oldStart: number;
}

export class BlockTokenStream {
  #definitionCounts: Map<string, number> | undefined;
  #definitionMembershipChanges: Set<string> | undefined;
  #fieldLength: number;
  #fields: Int32Array;
  #groupField = -1;
  #metadata: Map<number, BlockTokenMeta> | undefined;
  #opens: number[] = [];
  #relativeStart: number;
  #sourceLength: number;

  constructor(sourceLength = 0) {
    this.#fieldLength = 0;
    this.#fields = new Int32Array();
    this.#relativeStart = Number.POSITIVE_INFINITY;
    this.#sourceLength = sourceLength;
  }

  reset(sourceLength: number): void {
    this.#definitionCounts?.clear();
    this.#definitionMembershipChanges?.clear();
    this.#fieldLength = 0;
    this.#groupField = -1;
    this.#metadata = void 0;
    this.#opens.length = 0;
    this.#relativeStart = Number.POSITIVE_INFINITY;
    this.#sourceLength = sourceLength;
  }

  get length(): number {
    return this.#fieldLength / BlockTokenField.Stride;
  }

  get sourceLength(): number {
    return this.#sourceLength;
  }

  hasDefinition(key: string): boolean {
    return this.#definitionCounts?.has(key) === true;
  }

  hasDefinitions(): boolean {
    return !!this.#definitionCounts?.size;
  }

  /** Appends a token, with an optional role override for context-dependent syntax. */
  push(
    kind: BlockKind,
    start: number,
    end: number,
    meta?: BlockTokenMeta,
    role?: BlockTokenRole,
  ): void {
    const field = this.#fieldLength;
    this.#ensureCapacity(field + BlockTokenField.Stride);
    this.#fields[field + BlockTokenField.Kind] = kind;
    this.#fields[field + BlockTokenField.Start] = start;
    this.#fields[field + BlockTokenField.End] = end;
    this.#fields[field + BlockTokenField.Length] = 0;
    this.#fieldLength += BlockTokenField.Stride;
    if (meta) {
      this.#metadata ??= new Map();
      this.#metadata.set(this.length - 1, meta);
      const definitionKey = meta.definitionKey;
      if (definitionKey !== void 0) {
        this.#updateDefinitionCount(definitionKey, 1, false);
      }
    }
    const encodedRole = role ?? kind;
    if (encodedRole >= BlockTokenRole.BlockOpen) {
      this.#indexToken(field, encodedRole);
    }
  }

  #indexToken(field: number, encodedRole: number): void {
    if (encodedRole < BlockTokenRole.Close) {
      this.#opens.push(field);
      return;
    }
    if (encodedRole < BlockTokenRole.Leaf) {
      const open = this.#opens.pop()!;
      this.#fields[open + BlockTokenField.Length] = (
        (field - open) / BlockTokenField.Stride + 1
      );
      return;
    }
    if (encodedRole < BlockTokenRole.Group) {
      this.#fields[field + BlockTokenField.Length] = 1;
      return;
    }
    const group = this.#groupField;
    const previous = field - BlockTokenField.Stride;
    if (
      group < 0 || previous < 0 ||
      this.#fields[previous + BlockTokenField.Kind] < BlockTokenRole.Group
    ) {
      this.#groupField = field;
      this.#fields[field + BlockTokenField.Length] = 1;
    }
    else {
      this.#fields[group + BlockTokenField.Length]++;
    }
  }

  nodeLength(index: number): number {
    return this.#fields[index * BlockTokenField.Stride + BlockTokenField.Length];
  }

  equalsAfterShift(
    index: number,
    next: BlockTokenStream,
    nextIndex: number,
    delta: number,
    damageStart?: number,
    damageEnd?: number,
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
    const metadata = this.#metadata?.get(index);
    const nextMetadata = next.#metadata?.get(nextIndex);
    if (metadata !== nextMetadata) {
      if (metadata?.definitionKey !== nextMetadata?.definitionKey) {
        return false;
      }
      const value = metadata?.value;
      const nextValue = nextMetadata?.value;
      if (
        value !== nextValue && (
          value === null || typeof value !== "object" ||
          nextValue === null || typeof nextValue !== "object"
        )
      ) {
        return false;
      }
      const text = metadata?.text;
      const nextText = nextMetadata?.text;
      if (text !== void 0 || nextText !== void 0) {
        return text === nextText;
      }
    }
    // Without a damage range, the caller has already proved the covered source stable.
    if (damageStart === void 0 || damageEnd === void 0) {
      return true;
    }
    return start === end || end <= damageStart || start >= damageEnd;
  }

  replace(
    start: number,
    end: number,
    replacement: BlockTokenStream,
    damageStart: number,
    damageEnd: number,
  ): BlockTokenChange {
    const previousLength = this.length;
    const replacedLength = end - start;
    const replacementLength = replacement.length;
    const sourceDelta = replacement.#sourceLength - this.#sourceLength;

    // 1. Narrow the reported damage to the tokens that actually changed.
    const overlapLength = Math.min(replacedLength, replacementLength);
    let stablePrefixLength = 0;
    while (
      stablePrefixLength < overlapLength &&
      this.equalsAfterShift(
        start + stablePrefixLength,
        replacement,
        stablePrefixLength,
        0,
        damageStart,
        damageEnd,
      )
    ) {
      stablePrefixLength++;
    }
    let stableSuffixLength = 0;
    while (
      stableSuffixLength < overlapLength - stablePrefixLength &&
      this.equalsAfterShift(
        end - 1 - stableSuffixLength,
        replacement,
        replacementLength - 1 - stableSuffixLength,
        sourceDelta,
        damageStart,
        damageEnd,
      )
    ) {
      stableSuffixLength++;
    }
    const oldStart = start + stablePrefixLength;
    const oldEnd = end - stableSuffixLength;
    const newEnd = start + replacementLength - stableSuffixLength;
    // Stable prefix and suffix keys matched above, so only the narrowed ranges can change membership.
    this.#definitionMembershipChanges?.clear();
    for (let index = oldStart; index < oldEnd; index++) {
      this.#updateDefinitionCount(this.#metadata?.get(index)?.definitionKey, -1, true);
    }
    for (let index = stablePrefixLength; index < replacementLength - stableSuffixLength; index++) {
      this.#updateDefinitionCount(replacement.#metadata?.get(index)?.definitionKey, 1, true);
    }
    const change: BlockTokenChange = {
      definitionMembershipChanges: this.#definitionMembershipChanges ?? emptySet,
      newEnd,
      oldEnd,
      oldStart,
    };

    // 2. Align coordinate encoding with the replacement boundary. Positions before it
    // stay absolute; the retained suffix becomes EOF-relative so sourceLength rebases it.
    if (this.#relativeStart < end) {
      for (let index = this.#relativeStart; index < end; index++) {
        const field = index * BlockTokenField.Stride;
        this.#fields[field + BlockTokenField.Start] += this.#sourceLength + 1;
        this.#fields[field + BlockTokenField.End] += this.#sourceLength + 1;
      }
    }
    else if (this.#relativeStart > end) {
      const relativeEnd = Math.min(this.#relativeStart, previousLength);
      for (let index = end; index < relativeEnd; index++) {
        const field = index * BlockTokenField.Stride;
        this.#fields[field + BlockTokenField.Start] -= this.#sourceLength + 1;
        this.#fields[field + BlockTokenField.End] -= this.#sourceLength + 1;
      }
    }

    // 3. Replace packed fields in place. A size-changing middle edit shifts the suffix,
    // growing the dense backing store only when its retained capacity is insufficient.
    if (end === previousLength) {
      const fieldStart = start * BlockTokenField.Stride;
      const fieldEnd = fieldStart + replacement.#fieldLength;
      this.#ensureCapacity(fieldEnd);
      this.#fields.set(replacement.#fields.subarray(0, replacement.#fieldLength), fieldStart);
      this.#fieldLength = fieldEnd;
    }
    else if (replacementLength === replacedLength) {
      const fieldStart = start * BlockTokenField.Stride;
      this.#fields.set(replacement.#fields.subarray(0, replacement.#fieldLength), fieldStart);
    }
    else {
      const fieldStart = start * BlockTokenField.Stride;
      const oldFieldEnd = end * BlockTokenField.Stride;
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
        if (replacedLength < this.#metadata.size) {
          for (let index = start; index < end; index++) {
            this.#metadata.delete(index);
          }
        }
        else {
          for (const index of this.#metadata.keys()) {
            if (index >= start && index < end) {
              this.#metadata.delete(index);
            }
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
    this.#sourceLength = replacement.#sourceLength;
    return change;
  }

  truncate(length: number): void {
    // A later append must not extend a group removed by truncation.
    this.#groupField = -1;
    this.#fieldLength = length * BlockTokenField.Stride;
    if (this.#metadata) {
      for (const [index, value] of this.#metadata) {
        if (index >= length) {
          this.#updateDefinitionCount(value.definitionKey, -1, false);
          this.#metadata.delete(index);
        }
      }
      if (this.#metadata.size === 0) {
        this.#metadata = void 0;
      }
    }
  }

  kind(index: number): BlockKind {
    return this.#fields[index * BlockTokenField.Stride] as BlockKind;
  }

  setKind(index: number, kind: BlockKind): void {
    this.#fields[index * BlockTokenField.Stride] = kind;
  }

  start(index: number): number {
    return this.#position(
      this.#fields[index * BlockTokenField.Stride + BlockTokenField.Start],
    );
  }

  setStart(index: number, start: number): void {
    this.#fields[index * BlockTokenField.Stride + BlockTokenField.Start] = start;
  }

  end(index: number): number {
    return this.#position(
      this.#fields[index * BlockTokenField.Stride + BlockTokenField.End],
    );
  }

  /** Returns the semantic content end before its trailing physical line ending. */
  contentEnd(source: string, index: number): number {
    const end = this.end(index);
    const last = source.charCodeAt(end - 1);
    return last === Character.LineFeed
      ? end - (source.charCodeAt(end - 2) === Character.CarriageReturn ? 2 : 1)
      : last === Character.CarriageReturn ? end - 1 : end;
  }

  text(source: string, index: number): string {
    return this.#metadata?.get(index)?.text ?? source.slice(this.start(index), this.end(index));
  }

  value<T>(index: number): T | undefined {
    return this.#metadata?.get(index)?.value as T | undefined;
  }

  definitionKey(index: number): string | undefined {
    return this.#metadata?.get(index)?.definitionKey;
  }

  #updateDefinitionCount(
    key: string | undefined,
    delta: number,
    trackMembership: boolean,
  ): void {
    if (key === void 0) {
      return;
    }
    const counts = this.#definitionCounts ??= new Map();
    const previousCount = counts.get(key) ?? 0;
    const nextCount = previousCount + delta;
    if (nextCount === 0) {
      counts.delete(key);
    }
    else {
      counts.set(key, nextCount);
    }
    if (trackMembership && (previousCount === 0) !== (nextCount === 0)) {
      const changes = this.#definitionMembershipChanges ??= new Set();
      if (!changes.delete(key)) {
        changes.add(key);
      }
    }
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
  lines: BlockLines,
  start: number,
  end: number,
  value?: unknown,
): void {
  const count = end - start;
  const tokenStart = lines.start(start);
  const lastLine = end - 1;
  const tokenEnd = lines.next(lastLine);
  let canSliceSource = lines.physicallyContiguous();
  if (!canSliceSource) {
    const previous = source[tokenStart - 1];
    canSliceSource = (
      // Tab overshoot is represented as virtual leading columns absent from the source slice.
      lines.prefixColumns(start) === 0 && (
        // A derived first line may begin inside its physical line after a container marker.
        tokenStart === 0 || previous === "\n" || previous === "\r"
      )
    );
    let previousLineEnd = lines.next(start);
    for (let line = start + 1; canSliceSource && line < end; line++) {
      // Continuity proves later lines begin at physical boundaries without rechecking source text.
      if (lines.prefixColumns(line) !== 0 || lines.start(line) !== previousLineEnd) {
        canSliceSource = false;
        break;
      }
      previousLineEnd = lines.next(line);
    }
  }

  let text: string | undefined;
  if (!canSliceSource) {
    const logicalLines = new Array<string>(count);
    for (let index = 0; index < count; index++) {
      logicalLines[index] = logicalLine(source, lines, start + index);
    }
    text = logicalLines.join("");
  }
  out.push(
    kind,
    tokenStart,
    tokenEnd,
    text === void 0 && value === void 0
      ? void 0
      : { text, value },
  );
}
