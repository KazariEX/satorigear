import { BlockKind, BlockRole } from "../constants/block.ts";
import { Character } from "../constants/character.ts";
import { emptySet } from "../primitives.ts";
import type { DirectNode } from "./profile.ts";

const enum BlockTokenField {
  Kind,
  Start,
  End,
  Length,
  Stride,
}

const enum BlockTokenCapacity {
  Initial = 16,
}

interface BlockTokenMeta {
  node?: DirectNode["node"];
  definitionKey?: string;
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
  #metadata?: (BlockTokenMeta | undefined)[];
  #opens: number[] = [];

  reset(): void {
    this.#definitionCounts?.clear();
    this.#definitionMembershipChanges?.clear();
    const metadata = this.#metadata;
    if (metadata) {
      const used = Math.min(metadata.length, this.length);
      for (let index = 0; index < used; index++) {
        metadata[index] = void 0;
      }
      // The metadata array grows by doubling. Keep one growth step of slack.
      const reserve = Math.max(used, BlockTokenCapacity.Initial);
      if (metadata.length > reserve * 2) {
        metadata.length = reserve;
      }
    }
    this.#fieldLength = 0;
    // Completed scans already emptied the stack; only a partial scan needs clearing.
    if (this.#opens.length) {
      this.#opens.length = 0;
    }
  }

  get length(): number {
    return this.#fieldLength / BlockTokenField.Stride;
  }

  hasDefinition(key: string): boolean {
    return this.#definitionCounts?.has(key) === true;
  }

  hasDefinitions(): boolean {
    return !!this.#definitionCounts?.size;
  }

  /** Appends a token and derives its structural role from its kind. */
  push(kind: BlockKind, start: number, end: number, meta?: BlockTokenMeta): void {
    const field = this.#fieldLength;
    this.#ensureCapacity(field + BlockTokenField.Stride);
    this.#fields[field | BlockTokenField.Kind] = kind;
    this.#fields[field | BlockTokenField.Start] = start;
    this.#fields[field | BlockTokenField.End] = end;
    this.#fields[field | BlockTokenField.Length] = 1;
    this.#fieldLength += BlockTokenField.Stride;
    if (kind >= BlockRole.Open && kind < BlockRole.Leaf) {
      this.#indexToken(field, kind);
    }
    if (meta) {
      const index = field / BlockTokenField.Stride;
      const metadata = this.#metadata ??= new Array(Math.max(index + 1, BlockTokenCapacity.Initial));
      if (index >= metadata.length) {
        metadata.length = Math.max(index + 1, metadata.length * 2);
      }
      metadata[index] = meta;
      const definitionKey = meta.definitionKey;
      if (definitionKey !== void 0) {
        this.#updateDefinitionCount(definitionKey, 1, false);
      }
    }
  }

  pushInlineFrame(kind: BlockKind, start: number, end: number, contentStart: number, contentEnd: number): void {
    this.closeInlineFrame(this.openInlineFrame(), kind, start, end, contentStart, contentEnd);
  }

  /** Reserve the frame header while its source ranges are being scanned. */
  openInlineFrame(): number {
    const index = this.length;
    this.#fieldLength += BlockTokenField.Stride;
    return index;
  }

  closeInlineFrame(
    index: number,
    kind: BlockKind,
    start: number,
    end: number,
    contentStart: number,
    contentEnd: number,
  ): void {
    const field = index * BlockTokenField.Stride;
    const content = this.#fieldLength;
    this.#ensureCapacity(content + BlockTokenField.Stride);
    this.#fields[field | BlockTokenField.Kind] = kind;
    this.#fields[field | BlockTokenField.Start] = start;
    this.#fields[field | BlockTokenField.End] = end;
    this.#fields[field | BlockTokenField.Length] = this.length - index + 1;
    this.#fields[content | BlockTokenField.Kind] = contentStart < contentEnd ? BlockKind.InlineChunk : BlockKind.None;
    this.#fields[content | BlockTokenField.Start] = contentStart;
    this.#fields[content | BlockTokenField.End] = contentEnd;
    this.#fields[content | BlockTokenField.Length] = 1;
    this.#fieldLength = content + BlockTokenField.Stride;
  }

  /** Indexes an open or closing structural token. */
  #indexToken(field: number, kind: number): void {
    if (kind < BlockRole.Close) {
      this.#opens.push(field);
    }
    else {
      const open = this.#opens.pop()!;
      this.#fields[open | BlockTokenField.Length] = (field - open) / BlockTokenField.Stride + 1;
    }
  }

  nodeLength(index: number): number {
    return this.#fields[index * BlockTokenField.Stride | BlockTokenField.Length];
  }

  replace(
    start: number,
    end: number,
    replacement: BlockTokenStream,
    damageStart: number,
    damageEnd: number,
    sourceDelta: number,
  ): BlockTokenChange {
    const previousLength = this.length;
    const replacedLength = end - start;
    const replacementLength = replacement.length;

    // 1. Narrow the reported damage to the tokens that actually changed.
    const overlapLength = Math.min(replacedLength, replacementLength);
    let stablePrefixLength = 0;
    while (
      stablePrefixLength < overlapLength &&
      this.#matchesAfterShift(
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
      this.#matchesAfterShift(
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

    // 2. Replace packed fields in place. A size-changing middle edit shifts the suffix,
    // growing the dense backing store only when its retained capacity is insufficient.
    const fieldStart = start * BlockTokenField.Stride;
    const replacementFieldLength = replacement.#fieldLength;
    let fieldLength = this.#fieldLength;
    if (end === previousLength) {
      fieldLength = fieldStart + replacementFieldLength;
      this.#ensureCapacity(fieldLength);
    }
    else if (replacementLength !== replacedLength) {
      const oldFieldEnd = end * BlockTokenField.Stride;
      const newFieldEnd = fieldStart + replacementFieldLength;
      fieldLength += newFieldEnd - oldFieldEnd;
      this.#ensureCapacity(fieldLength);
      this.#fields.copyWithin(newFieldEnd, oldFieldEnd, this.#fieldLength);
    }
    this.#fields.set(replacement.#fields.subarray(0, replacementFieldLength), fieldStart);
    this.#fieldLength = fieldLength;

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
        copyMetadata(target, replacementMetadata, 0, replacementLength, start);
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
        copyMetadata(metadata, replacementMetadata, 0, replacementLength, start);
      }
      this.#metadata = metadata.length > 0 ? metadata : void 0;
    }

    // All coordinates stay absolute, so the retained suffix moves once with this edit.
    const newSuffixStart = start + replacementLength;
    if (sourceDelta !== 0 && newSuffixStart < this.length) {
      const suffixFieldStart = newSuffixStart * BlockTokenField.Stride;
      for (let field = suffixFieldStart; field < this.#fieldLength; field += BlockTokenField.Stride) {
        this.#fields[field | BlockTokenField.Start] += sourceDelta;
        this.#fields[field | BlockTokenField.End] += sourceDelta;
      }
    }
    return change;
  }

  #matchesAfterShift(
    index: number,
    next: BlockTokenStream,
    nextIndex: number,
    delta: number,
    damageStart: number,
    damageEnd: number,
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
    }
    return start === end || end <= damageStart || start >= damageEnd;
  }

  kind(index: number): BlockKind {
    return this.#fields[index * BlockTokenField.Stride] as BlockKind;
  }

  setKind(index: number, kind: BlockKind): void {
    this.#fields[index * BlockTokenField.Stride] = kind;
  }

  start(index: number): number {
    return this.#fields[index * BlockTokenField.Stride | BlockTokenField.Start];
  }

  setStart(index: number, start: number): void {
    this.#fields[index * BlockTokenField.Stride | BlockTokenField.Start] = start;
  }

  end(index: number): number {
    return this.#fields[index * BlockTokenField.Stride | BlockTokenField.End];
  }

  /** Returns the semantic content end before its trailing physical line ending. */
  contentEnd(source: string, index: number): number {
    const start = this.start(index);
    const end = this.end(index);
    if (end <= start) {
      return end;
    }
    const code = source.charCodeAt(end - 1);
    return code === Character.LineFeed
      ? end - (
        end > start + 1 && source.charCodeAt(end - 2) === Character.CarriageReturn
          ? 2
          : 1
      )
      : code === Character.CarriageReturn
        ? end - 1
        : end;
  }

  node(index: number): DirectNode["node"] | undefined {
    return this.#metadata?.[index]?.node;
  }

  value<T>(index: number): T | undefined {
    return this.#metadata?.[index]?.value as T | undefined;
  }

  setValue(index: number, value: unknown): void {
    this.#metadata ??= [];
    this.#metadata[index] ??= {};
    this.#metadata[index].value = value;
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
    if (trackMembership && (previousCount === 0 || nextCount === 0)) {
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
    let capacity = Math.max(BlockTokenCapacity.Initial * BlockTokenField.Stride, this.#fields.length * 2);
    while (capacity < length) {
      capacity *= 2;
    }
    const fields = new Int32Array(capacity);
    fields.set(this.#fields.subarray(0, this.#fieldLength));
    this.#fields = fields;
  }
}
