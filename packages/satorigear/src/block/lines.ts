import type { Buffer } from "node:buffer";
import { Character } from "../constants/character.ts";
import type { SourceLocation, SourceLocator, SourcePosition } from "../source-view.ts";

const enum BlockLineField {
  Start,
  End,
  Next,
  State,
  Stride,
}

const enum BlockLineState {
  Lazy = 1,
}

const enum BlockLineCapacity {
  Initial = 4,
  DoublingLimit = 16,
}

export const enum IndentedLine {
  Underindented = -1,
  Blank,
  Appended,
}

interface ScanningResult {
  fields: Int32Array;
  length: number;
  normalized: boolean;
}

// Typical Markdown lines exceed 16 characters; cap the hint at 16,384 lines.
function getLineCapacity(sourceLength: number): number {
  return Math.min((sourceLength + 15) >>> 4, 16384);
}

function growLineFields(fields: Int32Array, fieldLength: number): Int32Array {
  if (fieldLength <= fields.length) {
    return fields;
  }
  let capacity = fields.length / BlockLineField.Stride;
  while (capacity < fieldLength / BlockLineField.Stride) {
    capacity += capacity < BlockLineCapacity.DoublingLimit
      ? Math.max(BlockLineCapacity.Initial, capacity)
      : capacity >>> 1;
  }
  const next = new Int32Array(capacity * BlockLineField.Stride);
  next.set(fields);
  return next;
}

class Latin1 {
  static minimum = 2048;
  static scratchBytes: Buffer | undefined;
  static scratchWords: Uint32Array | undefined;
  static scratchLimit = 0;

  // eslint-disable-next-line node/prefer-global/buffer
  static allocate = globalThis.Buffer?.allocUnsafeSlow;

  static scan(source: string, fields: Int32Array): ScanningResult {
    const limit = source.length;
    const wordLimit = limit + 31 & ~31;
    if (this.scratchLimit < wordLimit) {
      const bytes = this.allocate(wordLimit);
      this.scratchBytes = bytes;
      this.scratchWords = new Uint32Array(bytes.buffer, bytes.byteOffset, wordLimit >>> 2);
      this.scratchLimit = wordLimit;
    }

    const bytes = this.scratchBytes!;
    const words = this.scratchWords!;
    // Pad the final word group with spaces so it cannot emit line endings.
    for (let i = 1; i <= 8; i++) {
      words[(wordLimit >>> 2) - i] = 0x20202020;
    }
    bytes.write(source, 0, limit, "latin1");
    let field = 0;
    let start = 0;
    let cursor = 0;
    let crnext = -1;
    while (cursor < wordLimit) {
      // Worst case: <= 1 row per real byte; padding emits nothing.
      // Reserving per segment keeps the inner loop free of growth checks.
      fields = growLineFields(fields, field + Math.min(32, limit - cursor) * BlockLineField.Stride);
      const available = (fields.length - field) / BlockLineField.Stride;
      const wordEnd = cursor > limit - available ? wordLimit : cursor + (available & ~31);
      for (; ;) {
        const offset = cursor >>> 2;
        const word0 = words[offset];
        const word1 = words[offset | 1];
        const word2 = words[offset | 2];
        const word3 = words[offset | 3];
        const word4 = words[offset | 4];
        const word5 = words[offset | 5];
        const word6 = words[offset | 6];
        const word7 = words[offset | 7];

        // Find potential line endings four bytes at a time.
        const hits0 = word0 - 0x10101010 & ~word0 & 0x80808080;
        const hits1 = word1 - 0x10101010 & ~word1 & 0x80808080;
        const hits2 = word2 - 0x10101010 & ~word2 & 0x80808080;
        const hits3 = word3 - 0x10101010 & ~word3 & 0x80808080;
        const hits4 = word4 - 0x10101010 & ~word4 & 0x80808080;
        const hits5 = word5 - 0x10101010 & ~word5 & 0x80808080;
        const hits6 = word6 - 0x10101010 & ~word6 & 0x80808080;
        const hits7 = word7 - 0x10101010 & ~word7 & 0x80808080;

        if (hits0 | hits1 | hits2 | hits3 | hits4 | hits5 | hits6 | hits7) {
          // 1. hits0 >>> 4 | hits1      => [3][7][11][15][19][23][27][31]
          // 2. Math.imul(~, Mag) >>> 24 => [0][4][ 1][ 5][ 2][ 6][ 3][ 7]
          let events = Math.imul(hits0 >>> 4 | hits1, 0x00204081) >>> 24
          /* .... */ | Math.imul(hits2 >>> 4 | hits3, 0x00204081) >>> 24 << 8
          /* .... */ | Math.imul(hits4 >>> 4 | hits5, 0x00204081) >>> 24 << 16
          /* .... */ | Math.imul(hits6 >>> 4 | hits7, 0x00204081) >>> 24 << 24;
          const last = cursor + 31;
          do {
            const at = last - Math.clz32(events & -events);
            const code = source.charCodeAt(at);
            // Latin1 copying retains low bytes, so exclude non-Latin1 aliases:
            // "上"(0x4E0A), "不"(0x4E0D), "č"(0x010D), ...
            if (code === Character.LineFeed || code === Character.CarriageReturn) {
              let next = at + 1;
              if (code === Character.CarriageReturn) {
                crnext = next;
                // Consume an adjacent LF in this block; cross-block LF uses the carry below.
                if (events >>> (at & 31) & 2 && source.charCodeAt(next) === Character.LineFeed) {
                  next++;
                  events &= events - 1;
                }
              }
              else if (at === crnext) {
                // Absorb the cross-block LF into the previous row's next.
                fields[field - BlockLineField.Stride | BlockLineField.Next] = next;
                start = next;
                continue;
              }
              fields[field | BlockLineField.Start] = start;
              fields[field | BlockLineField.End] = at;
              fields[field | BlockLineField.Next] = next;
              fields[field | BlockLineField.State] = 0;
              field += BlockLineField.Stride;
              start = next;
            }
          } while (events &= events - 1);
        }
        cursor += 32;
        if (cursor >= wordEnd) {
          break;
        }
      }
    }

    if (start < limit) {
      fields = growLineFields(fields, field + BlockLineField.Stride);
      fields[field | BlockLineField.Start] = start;
      fields[field | BlockLineField.End] = limit;
      fields[field | BlockLineField.Next] = limit;
      fields[field | BlockLineField.State] = 0;
      field += BlockLineField.Stride;
    }

    return {
      fields,
      length: field / BlockLineField.Stride,
      normalized: crnext < 0,
    };
  }
}

class Index0 {
  static scan(source: string, fields: Int32Array): ScanningResult {
    let field = 0;
    let start = 0;
    let lf = source.indexOf("\n");
    let cr = source.indexOf("\r");
    const normalized = cr < 0;
    const limit = source.length;

    while (start < limit) {
      let end = lf;
      let next = end + 1;
      if (cr !== -1 && (end < 0 || cr < end)) {
        end = cr;
        next = end + (source.charCodeAt(end + 1) === Character.LineFeed ? 2 : 1);
        cr = source.indexOf("\r", next);
        if (lf !== -1 && lf < next) {
          lf = source.indexOf("\n", next);
        }
      }
      else if (lf < 0) {
        end = next = limit;
      }
      else {
        lf = source.indexOf("\n", next);
      }
      if (field >= fields.length) {
        fields = growLineFields(fields, field + BlockLineField.Stride);
      }
      fields[field | BlockLineField.Start] = start;
      fields[field | BlockLineField.End] = end;
      fields[field | BlockLineField.Next] = next;
      fields[field | BlockLineField.State] = 0;
      field += BlockLineField.Stride;
      start = next;
    }

    return {
      fields,
      length: field / BlockLineField.Stride,
      normalized,
    };
  }
}

export class BlockLines implements SourceLocator {
  #fields: Int32Array;
  #length = 0;
  #locatorField = 0;
  #normalized = true;
  #sourceLength: number;

  constructor(sourceLength = 0, capacity: number = BlockLineCapacity.Initial) {
    this.#sourceLength = sourceLength;
    this.#fields = new Int32Array(capacity * BlockLineField.Stride);
  }

  /** Rebuilds the physical line index while retaining its backing store. */
  scan(source: string): void {
    this.#locatorField = 0;
    this.#sourceLength = source.length;
    const fields = growLineFields(this.#fields, getLineCapacity(source.length) * BlockLineField.Stride);
    const result = source.length >= Latin1.minimum && Latin1.allocate !== void 0
      ? Latin1.scan(source, fields)
      : Index0.scan(source, fields);
    this.#fields = result.fields;
    this.#length = result.length;
    this.#normalized = result.normalized;
  }

  get length(): number {
    return this.#length;
  }

  start(index: number): number {
    return this.#fields[index * BlockLineField.Stride | BlockLineField.Start];
  }

  end(index: number): number {
    return this.#fields[index * BlockLineField.Stride | BlockLineField.End];
  }

  next(index: number): number {
    return this.#fields[index * BlockLineField.Stride | BlockLineField.Next];
  }

  prefixColumns(index: number): number {
    return this.#fields[index * BlockLineField.Stride | BlockLineField.State] >>> 1;
  }

  lazy(index: number): boolean {
    return (this.#fields[index * BlockLineField.Stride | BlockLineField.State] & BlockLineState.Lazy) !== 0;
  }

  indexAtOrAfter(offset: number): number {
    let low = 0;
    let high = this.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.start(middle) < offset) {
        low = middle + 1;
      }
      else {
        high = middle;
      }
    }
    return low;
  }

  /** Resets and returns the line-owned locator for monotonically increasing source offsets. */
  locator(): SourceLocator {
    this.#locatorField = 0;
    return this;
  }

  /** Normalizes a fragment only when retained source may contain carriage returns. */
  normalizeLineEndings(value: string): string {
    return this.#normalized || !value.includes("\r")
      ? value
      : value.replace(/\r\n|\r/g, "\n");
  }

  /**
   * Locates an offset in the physical line table after {@link locator} resets the cursor.
   * The next offset of each physical line is the start of its successor, or the source length.
   */
  locationAt(offset: number): SourceLocation {
    const length = this.#length;
    if (length === 0) {
      return { line: 1, column: 1, offset };
    }
    const fields = this.#fields;
    let field = this.#locatorField;
    if (fields[field | BlockLineField.Next] <= offset) {
      const sourceLength = this.#sourceLength;
      if (offset < sourceLength) {
        do {
          field += BlockLineField.Stride;
        }
        while (fields[field | BlockLineField.Next] <= offset);
      }
      else {
        field = (length - 1) * BlockLineField.Stride;
        if (offset === sourceLength && fields[field | BlockLineField.End] < offset) {
          return { line: length + 1, column: 1, offset };
        }
      }
      this.#locatorField = field;
    }
    return {
      line: field / BlockLineField.Stride + 1,
      column: offset - fields[field | BlockLineField.Start] + 1,
      offset,
    };
  }

  /** Locates both boundaries when no nested projection must occur between them. */
  positionAt(start: number, end: number): SourcePosition {
    return {
      start: this.locationAt(start),
      end: this.locationAt(end),
    };
  }

  /** Whether this view retains physically adjacent source lines. */
  physicallyContiguous(): boolean {
    return this.#sourceLength > 0;
  }

  push(
    start: number,
    end: number,
    next: number,
    prefixColumns: number,
    lazy: boolean,
  ): void {
    const field = this.#length * BlockLineField.Stride;
    let fields = this.#fields;
    if (field >= fields.length) {
      this.#fields = growLineFields(this.#fields, field + BlockLineField.Stride);
      fields = this.#fields;
    }
    const state = prefixColumns * 2 + (lazy ? BlockLineState.Lazy : 0);
    fields[field | BlockLineField.Start] = start;
    fields[field | BlockLineField.End] = end;
    fields[field | BlockLineField.Next] = next;
    fields[field | BlockLineField.State] = state;
    this.#length++;
  }

  pushFrom(
    lines: BlockLines,
    index: number,
    start = lines.start(index),
    prefixColumns = lines.prefixColumns(index),
    lazy = lines.lazy(index),
  ): void {
    this.push(start, lines.end(index), lines.next(index), prefixColumns, lazy);
  }

  /** Appends projected content, or reports why the source line was not appended. */
  pushAfterColumns(source: string, lines: BlockLines, index: number, columns: number): IndentedLine {
    let offset = lines.start(index);
    let consumed = lines.prefixColumns(index);
    const end = lines.end(index);
    while (offset < end && consumed < columns) {
      const code = source.charCodeAt(offset);
      if (code === Character.Space) {
        consumed++;
      }
      else if (code === Character.CharacterTabulation) {
        consumed += 4 - (consumed % 4);
      }
      else {
        break;
      }
      offset++;
    }
    if (offset === end) {
      return IndentedLine.Blank;
    }
    if (consumed < columns) {
      return IndentedLine.Underindented;
    }
    const contentOffset = offset;
    const prefixColumns = consumed - columns;
    if (trimLineWhitespaceStart(source, offset, end) < end) {
      this.pushFrom(lines, index, contentOffset, prefixColumns);
      return IndentedLine.Appended;
    }
    return IndentedLine.Blank;
  }

  pushLazy(lines: BlockLines, index: number): void {
    this.pushFrom(lines, index, void 0, void 0, true);
  }

  resetFrom(
    lines: BlockLines,
    index: number,
    start = lines.start(index),
    prefixColumns = lines.prefixColumns(index),
    lazy = lines.lazy(index),
  ): void {
    const end = lines.end(index);
    const next = lines.next(index);
    this.#length = 0;
    this.push(start, end, next, prefixColumns, lazy);
  }

  /** Borrows a range for reading; the owner retains the backing store. */
  view(start: number, end = this.length): BlockLines {
    const result = new BlockLines(this.#sourceLength, 0);
    result.#fields = this.#fields.subarray(
      start * BlockLineField.Stride,
      end * BlockLineField.Stride,
    );
    result.#length = end - start;
    result.#normalized = this.#normalized;
    return result;
  }

  #copy(): BlockLines {
    // Editing owns an independent copy of the geometry it will overwrite.
    const next = new BlockLines(this.#sourceLength, 0);
    next.#fields = this.#fields.slice(0, this.#length * BlockLineField.Stride);
    next.#length = this.#length;
    next.#normalized = this.#normalized;
    return next;
  }

  update(
    nextSource: string,
    restartOffset: number,
    oldDamageEnd: number,
    delta: number,
  ): BlockLines {
    // Rebuild one following line so edits at line-ending boundaries cannot retain stale geometry.
    const suffix = Math.min(this.length, this.indexAtOrAfter(oldDamageEnd + 1) + 1);
    const oldSuffixOffset = suffix < this.length
      ? this.start(suffix)
      : nextSource.length - delta;
    const newSuffixOffset = oldSuffixOffset + delta;
    let prefixEnd = this.indexAtOrAfter(restartOffset);
    // A newly formed CRLF also changes the retained physical line before the block restart.
    if (
      nextSource.charCodeAt(restartOffset - 1) === Character.CarriageReturn &&
      nextSource.charCodeAt(restartOffset) === Character.LineFeed
    ) {
      restartOffset = this.start(--prefixEnd);
    }
    // Isolate the rebuilt range so a trailing CR cannot consume an LF outside it.
    const changedSource = nextSource.slice(restartOffset, newSuffixOffset);
    const changed = new BlockLines(0, getLineCapacity(changedSource.length));
    changed.scan(changedSource);
    if (restartOffset !== 0) {
      changed.#shiftPositions(0, restartOffset);
    }
    // Equal-length edits preserve line slots, so only overwrite the rebuilt window.
    if (delta === 0 && changed.length === suffix - prefixEnd) {
      const next = this.#copy();
      const target = prefixEnd * BlockLineField.Stride;
      const fieldLength = changed.length * BlockLineField.Stride;
      for (let field = 0; field < fieldLength; field++) {
        next.#fields[target + field] = changed.#fields[field];
      }
      next.#normalized &&= changed.#normalized;
      return next;
    }
    const next = new BlockLines(
      nextSource.length,
      prefixEnd + changed.length + this.length - suffix,
    );
    // Stored coordinates stay absolute. The retained suffix moves once with the edit.
    next.#appendRawRange(this, 0, prefixEnd);
    next.#appendRawRange(changed, 0, changed.length);
    const suffixStart = next.length;
    next.#appendRawRange(this, suffix, this.length);
    if (delta !== 0) {
      next.#shiftPositions(suffixStart, delta);
    }
    next.#normalized = this.#normalized && changed.#normalized;
    return next;
  }

  pop(): void {
    if (this.#length > 0) {
      this.#length--;
    }
  }

  /** Appends stored fields unchanged. */
  #appendRawRange(lines: BlockLines, start: number, end: number): void {
    if (start >= end) {
      return;
    }
    const sourceStart = start * BlockLineField.Stride;
    const sourceEnd = end * BlockLineField.Stride;
    const targetStart = this.#length * BlockLineField.Stride;
    const targetEnd = targetStart + sourceEnd - sourceStart;
    this.#fields = growLineFields(this.#fields, targetEnd);
    this.#fields.set(lines.#fields.subarray(sourceStart, sourceEnd), targetStart);
    this.#length += end - start;
  }

  #shiftPositions(start: number, delta: number): void {
    const fields = this.#fields;
    const fieldLength = this.#length * BlockLineField.Stride;
    for (let field = start * BlockLineField.Stride; field < fieldLength; field += BlockLineField.Stride) {
      fields[field | BlockLineField.Start] += delta;
      fields[field | BlockLineField.End] += delta;
      fields[field | BlockLineField.Next] += delta;
    }
  }
}

/** Returns the offset after up to three indent columns; tabs exceed this limit. */
export function indentOffset(source: string, lines: BlockLines, index: number): number {
  let offset = lines.start(index);
  const limit = offset + 3 - lines.prefixColumns(index);
  const end = lines.end(index);
  while (offset < end && offset < limit && source.charCodeAt(offset) === Character.Space) {
    offset++;
  }
  return offset;
}

/**
 * Returns the first content offset after consuming up to three indent columns.
 *
 * Unlike {@link indentOffset}, returns -1 for blank lines or indent beyond three columns.
 * Inlining the scan improves repeated large-document block-dispatch throughput.
 */
export function lineIndentOffset(source: string, lines: BlockLines, index: number): number {
  let offset = lines.start(index);
  const limit = offset + 3 - lines.prefixColumns(index);
  const end = lines.end(index);
  while (offset < end && offset < limit && source.charCodeAt(offset) === Character.Space) {
    offset++;
  }
  if (offset > limit || offset === end) {
    return -1;
  }
  const code = source.charCodeAt(offset);
  return code === Character.Space || code === Character.CharacterTabulation
    ? -1
    : offset;
}

export function isBlankLine(source: string, lines: BlockLines, index: number): boolean {
  const end = lines.end(index);
  return trimLineWhitespaceStart(source, lines.start(index), end) === end;
}

export function trimLineWhitespaceStart(source: string, start: number, end: number): number {
  while (start < end) {
    const code = source.charCodeAt(start);
    if (code !== Character.Space && code !== Character.CharacterTabulation) {
      break;
    }
    start++;
  }
  return start;
}

export function trimLineWhitespaceEnd(source: string, start: number, end: number): number {
  while (end > start) {
    const code = source.charCodeAt(end - 1);
    if (code !== Character.Space && code !== Character.CharacterTabulation) {
      break;
    }
    end--;
  }
  return end;
}

export function physicalColumnAt(source: string, offset: number): number {
  let start = offset;
  while (start > 0) {
    const code = source.charCodeAt(start - 1);
    if (code === Character.LineFeed || code === Character.CarriageReturn) {
      break;
    }
    start--;
  }
  let column = 0;
  while (start < offset) {
    column += source.charCodeAt(start) === Character.CharacterTabulation ? 4 - (column % 4) : 1;
    start++;
  }
  return column;
}
