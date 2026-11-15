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
  static alloc = globalThis.Buffer?.allocUnsafeSlow;

  static scan(source: string, fields: Int32Array): ScanningResult {
    const limit = source.length;
    const wordLimit = limit + 7 & ~7;
    if (this.scratchLimit < wordLimit) {
      const bytes = this.alloc(wordLimit);
      this.scratchBytes = bytes;
      this.scratchWords = new Uint32Array(bytes.buffer, bytes.byteOffset, wordLimit >>> 2);
      this.scratchLimit = wordLimit;
    }

    const bytes = this.scratchBytes!;
    const words = this.scratchWords!;
    // Clear the final block before copying so padding cannot emit newline events.
    words[(wordLimit >>> 2) - 2] = 0;
    words[(wordLimit >>> 2) - 1] = 0;
    bytes.write(source, 0, limit, "latin1");
    let field = 0;
    let start = 0;
    let cursor = 0;
    let crnext = -1;
    while (cursor < wordLimit) {
      // Reserve at most one row per real input unit; padding needs no capacity.
      // This bounds each segment without per-row growth checks.
      fields = growLineFields(fields, field + Math.min(8, limit - cursor) * BlockLineField.Stride);
      const available = (fields.length - field) / BlockLineField.Stride;
      const wordEnd = cursor > limit - available ? wordLimit : cursor + (available & ~7);
      for (
        let word0 = words[cursor >>> 2], word1 = words[(cursor >>> 2) + 1]
        // eslint-disable-next-line style/semi-style
        ; ; word0 = words[cursor >>> 2], word1 = words[(cursor >>> 2) + 1]
      ) {
        const mixed0 = word0 ^ (word0 & 0x01010101) * 7 ^ 0x0A0A0A0A;
        const mixed1 = word1 ^ (word1 & 0x01010101) * 7 ^ 0x0A0A0A0A;
        // Folding preserves the high bits; the even folded bytes make this mask exact.
        const hits0 = mixed0 - 0x01010101 & ~word0 & 0x80808080;
        const hits1 = mixed1 - 0x01010101 & ~word1 & 0x80808080;
        if (hits0 | hits1) {
          // Interleave both masks, then pack all eight positions with one multiply.
          let events = Math.imul(hits0 >>> 4 | hits1, 0x00204081) >>> 24;
          do {
            const at = cursor + (~Math.clz32(events & -events) & 7);
            const code = source.charCodeAt(at);
            // Latin1 copying retains low bytes, so exclude non-Latin1 aliases.
            if (code <= 0xFF) {
              let next = at + 1;
              if (code === Character.CarriageReturn) {
                crnext = next;
                // Consume an adjacent LF in this block; cross-block LF uses the carry below.
                if (events >>> (at & 7) & 2 && source.charCodeAt(next) === Character.LineFeed) {
                  next++;
                  events &= events - 1;
                }
              }
              else if (at === crnext) {
                fields[field - 2] = next;
                start = next;
                continue;
              }
              // Four fields per row fit in 31 bits under Node's string length limit.
              fields[field | BlockLineField.Start] = start;
              fields[field | BlockLineField.End] = at;
              fields[field | BlockLineField.Next] = next;
              fields[field | BlockLineField.State] = 0;
              field = field + BlockLineField.Stride & 0x7FFFFFFF;
              start = next;
            }
          } while (events &= events - 1);
        }
        cursor += 8;
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
      field = field + BlockLineField.Stride & 0x7FFFFFFF;
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
      fields[field++] = start;
      fields[field++] = end;
      fields[field++] = next;
      fields[field++] = 0;
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
    const result = source.length >= Latin1.minimum && Latin1.alloc !== void 0
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
   * After {@link locator} resets the monotonic cursor, this stable method keeps projection
   * monomorphic across documents; per-parse closures would invalidate its optimized call target.
   */
  locationAt(offset: number): SourceLocation {
    const fieldLength = this.#length * BlockLineField.Stride;
    if (fieldLength === 0) {
      return { line: 1, column: 1, offset };
    }
    const fields = this.#fields;
    const sourceLength = this.#sourceLength;
    if (
      offset === sourceLength &&
      fields[fieldLength - BlockLineField.Stride | BlockLineField.End] < sourceLength
    ) {
      return {
        line: fieldLength / BlockLineField.Stride + 1,
        column: 1,
        offset,
      };
    }
    let field = this.#locatorField;
    let start = fields[field | BlockLineField.Start];
    while (field + BlockLineField.Stride < fieldLength) {
      const nextStart = fields[field + BlockLineField.Stride | BlockLineField.Start];
      if (nextStart > offset) {
        break;
      }
      field += BlockLineField.Stride;
      start = nextStart;
    }
    this.#locatorField = field;
    return {
      line: field / BlockLineField.Stride + 1,
      column: offset - start + 1,
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
