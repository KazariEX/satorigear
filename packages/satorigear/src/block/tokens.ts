import { type BlockKind, BlockRole } from "../constants/block.ts";
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

function copyMetadata(
  target: (BlockTokenMeta | undefined)[],
  source: Readonly<typeof target>,
  start: number,
  end: number,
  targetStart: number,
): void {
  end = Math.min(end, source.length);
  for (let read = start, write = targetStart; read < end; read++, write++) {
    const value = source[read];
    if (value) {
      target[write] = value;
    }
  }
}

export interface BlockTokenChange {
  // Borrowed until reset() or the next replace(); contains exactly the keys whose membership changed.
  definitionMembershipChanges: ReadonlySet<string>;
  newEnd: number;
  oldEnd: number;
  oldStart: number;
}

export interface DefinitionLookup {
  hasDefinition: (key: string) => boolean;
  hasDefinitions: () => boolean;
}

export class BlockTokenStream implements DefinitionLookup {
  #definitionCounts: Map<string, number> | undefined;
  #definitionMembershipChanges: Set<string> | undefined;
  #fieldLength = 0;
  #fields = new Int32Array();
  #groupField = -1;
  #metadata?: (BlockTokenMeta | undefined)[];
  #opens: number[] = [];
  #relativeStart = Infinity;
  #sourceLength: number;

  constructor(sourceLength = 0) {
    this.#sourceLength = sourceLength;
  }

  reset(sourceLength: number): void {
    this.#definitionCounts?.clear();
    this.#definitionMembershipChanges?.clear();
    this.#fieldLength = 0;
    this.#groupField = -1;
    this.#metadata = void 0;
    this.#opens.length = 0;
    this.#relativeStart = Infinity;
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
    role?: BlockRole,
  ): void {
    const field = this.#fieldLength;
    this.#ensureCapacity(field + BlockTokenField.Stride);
    this.#fields[field + BlockTokenField.Kind] = kind;
    this.#fields[field + BlockTokenField.Start] = start;
    this.#fields[field + BlockTokenField.End] = end;
    this.#fields[field + BlockTokenField.Length] = 0;
    this.#fieldLength += BlockTokenField.Stride;
    if (meta) {
      this.#metadata ??= [];
      this.#metadata[this.length - 1] = meta;
      const definitionKey = meta.definitionKey;
      if (definitionKey !== void 0) {
        this.#updateDefinitionCount(definitionKey, 1, false);
      }
    }
    const encodedRole = role ?? kind;
    if (encodedRole >= BlockRole.BlockOpen) {
      this.#indexToken(field, encodedRole);
    }
  }

  #indexToken(field: number, encodedRole: number): void {
    if (encodedRole < BlockRole.Close) {
      this.#opens.push(field);
      return;
    }
    if (encodedRole < BlockRole.Leaf) {
      const open = this.#opens.pop()!;
      this.#fields[open + BlockTokenField.Length] = (
        (field - open) / BlockTokenField.Stride + 1
      );
      return;
    }
    if (encodedRole < BlockRole.Group) {
      this.#fields[field + BlockTokenField.Length] = 1;
      return;
    }
    const group = this.#groupField;
    const previous = field - BlockTokenField.Stride;
    if (
      group < 0 || previous < 0 ||
      this.#fields[previous + BlockTokenField.Kind] < BlockRole.Group
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
    const metadata = this.#metadata?.[index];
    const nextMetadata = next.#metadata?.[nextIndex];
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
      this.#updateDefinitionCount(this.#metadata?.[index]?.definitionKey, -1, true);
    }
    for (let index = stablePrefixLength; index < replacementLength - stableSuffixLength; index++) {
      this.#updateDefinitionCount(replacement.#metadata?.[index]?.definitionKey, 1, true);
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
    // middle replacement shifts suffix slots into a new array.
    const indexDelta = replacementLength - replacedLength;
    if (end === previousLength || indexDelta === 0) {
      const metadata = this.#metadata;
      if (metadata) {
        metadata.fill(void 0, start, end);
      }
      const replacementMetadata = replacement.#metadata;
      if (replacementMetadata) {
        const target = this.#metadata ??= [];
        copyMetadata(target, replacementMetadata, 0, replacementMetadata.length, start);
      }
      if (end === previousLength && this.#metadata) {
        this.#metadata.length = Math.min(this.#metadata.length, start + replacementLength);
      }
    }
    else {
      const metadata: (BlockTokenMeta | undefined)[] = [];
      const previousMetadata = this.#metadata;
      if (previousMetadata) {
        copyMetadata(metadata, previousMetadata, 0, start, 0);
        copyMetadata(
          metadata,
          previousMetadata,
          end,
          previousMetadata.length,
          end + indexDelta,
        );
      }
      const replacementMetadata = replacement.#metadata;
      if (replacementMetadata) {
        copyMetadata(metadata, replacementMetadata, 0, replacementMetadata.length, start);
      }
      this.#metadata = metadata.length > 0 ? metadata : void 0;
    }

    const newSuffixStart = start + replacementLength;
    this.#relativeStart = newSuffixStart < this.length ? newSuffixStart : Infinity;
    this.#sourceLength = replacement.#sourceLength;
    return change;
  }

  truncate(length: number): void {
    // A later append must not extend a group removed by truncation.
    this.#groupField = -1;
    this.#fieldLength = length * BlockTokenField.Stride;
    const metadata = this.#metadata;
    if (metadata) {
      for (let index = length; index < metadata.length; index++) {
        const value = metadata[index];
        if (value) {
          this.#updateDefinitionCount(value.definitionKey, -1, false);
        }
      }
      metadata.length = Math.min(metadata.length, length);
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
    return this.#metadata?.[index]?.text ?? source.slice(this.start(index), this.end(index));
  }

  value<T>(index: number): T | undefined {
    return this.#metadata?.[index]?.value as T | undefined;
  }

  definitionKey(index: number): string | undefined {
    return this.#metadata?.[index]?.definitionKey;
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
