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

export const enum IndentedLine {
  Underindented = -1,
  Blank,
  Appended,
}

function growLineFields(fields: Int32Array, fieldLength: number): Int32Array {
  if (fieldLength <= fields.length) {
    return fields;
  }
  let capacity = fields.length / BlockLineField.Stride;
  while (capacity < fieldLength / BlockLineField.Stride) {
    capacity += capacity < 16 ? Math.max(4, capacity) : capacity >>> 1;
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

  static prepare(limit: number): boolean {
    if (this.scratchLimit < limit) {
      // eslint-disable-next-line node/prefer-global/buffer
      const Buffer = globalThis.Buffer;
      const alloc = Buffer?.allocUnsafeSlow ?? Buffer?.allocUnsafe;
      if (alloc === void 0) {
        return false;
      }
      // Shift a pooled or odd offset onto a 4-byte boundary instead of giving up.
      const raw = alloc(limit + 3);
      const align = 4 - (raw.byteOffset & 3) & 3;
      const bytes = raw.subarray(align, align + limit);
      this.scratchBytes = bytes;
      this.scratchWords = new Uint32Array(bytes.buffer, bytes.byteOffset, limit >>> 2);
      this.scratchLimit = limit;
    }
    return true;
  }

  // eslint-disable-next-line ts/explicit-function-return-type
  static scan(source: string, fields: Int32Array) {
    const bytes = this.scratchBytes!;
    const words = this.scratchWords!;
    const limit = source.length;
    bytes.write(source, 0, limit, "latin1");
    let field = 0;
    let start = 0;
    let normalized = true;
    const wordLimit = limit & ~7;
    let cursor = 0;
    while (cursor < wordLimit) {
      // One input unit can emit at most one row. The available output capacity
      // bounds a safe input block, so the word loop needs no per-row growth check.
      fields = growLineFields(fields, field + 8 * BlockLineField.Stride);
      const wordEnd = Math.min(wordLimit, cursor + ((fields.length - field) / BlockLineField.Stride & ~7));
      for (; cursor < wordEnd; cursor += 8) {
        const word0 = words[cursor >>> 2];
        const mixed0 = word0 ^ (word0 & 0x01010101) * 7 ^ 0x0A0A0A0A;
        const mask0 = mixed0 - 0x01010101 & ~mixed0 & 0x80808080;
        const word1 = words[(cursor >>> 2) + 1];
        const mixed1 = word1 ^ (word1 & 0x01010101) * 7 ^ 0x0A0A0A0A;
        const mask1 = mixed1 - 0x01010101 & ~mixed1 & 0x80808080;
        if (mask0 !== 0) {
          if (mask0 & 0x80) {
            const at = cursor;
            const code = source.charCodeAt(at);
            if (at >= start && (code === Character.LineFeed || code === Character.CarriageReturn)) {
              let next = at + 1;
              if (code === Character.CarriageReturn) {
                normalized = false;
                if (source.charCodeAt(next) === Character.LineFeed) {
                  next++;
                }
              }
              fields[field++] = start;
              fields[field++] = at;
              fields[field++] = next;
              fields[field++] = 0;
              start = next;
            }
          }
          if (mask0 & 0x8000) {
            const at = cursor + 1;
            const code = source.charCodeAt(at);
            if (at >= start && (code === Character.LineFeed || code === Character.CarriageReturn)) {
              let next = at + 1;
              if (code === Character.CarriageReturn) {
                normalized = false;
                if (source.charCodeAt(next) === Character.LineFeed) {
                  next++;
                }
              }
              fields[field++] = start;
              fields[field++] = at;
              fields[field++] = next;
              fields[field++] = 0;
              start = next;
            }
          }
          if (mask0 & 0x800000) {
            const at = cursor + 2;
            const code = source.charCodeAt(at);
            if (at >= start && (code === Character.LineFeed || code === Character.CarriageReturn)) {
              let next = at + 1;
              if (code === Character.CarriageReturn) {
                normalized = false;
                if (source.charCodeAt(next) === Character.LineFeed) {
                  next++;
                }
              }
              fields[field++] = start;
              fields[field++] = at;
              fields[field++] = next;
              fields[field++] = 0;
              start = next;
            }
          }
          if (mask0 & 0x80000000) {
            const at = cursor + 3;
            const code = source.charCodeAt(at);
            if (at >= start && (code === Character.LineFeed || code === Character.CarriageReturn)) {
              let next = at + 1;
              if (code === Character.CarriageReturn) {
                normalized = false;
                if (source.charCodeAt(next) === Character.LineFeed) {
                  next++;
                }
              }
              fields[field++] = start;
              fields[field++] = at;
              fields[field++] = next;
              fields[field++] = 0;
              start = next;
            }
          }
        }
        if (mask1 !== 0) {
          if (mask1 & 0x80) {
            const at = cursor + 4;
            const code = source.charCodeAt(at);
            if (at >= start && (code === Character.LineFeed || code === Character.CarriageReturn)) {
              let next = at + 1;
              if (code === Character.CarriageReturn) {
                normalized = false;
                if (source.charCodeAt(next) === Character.LineFeed) {
                  next++;
                }
              }
              fields[field++] = start;
              fields[field++] = at;
              fields[field++] = next;
              fields[field++] = 0;
              start = next;
            }
          }
          if (mask1 & 0x8000) {
            const at = cursor + 5;
            const code = source.charCodeAt(at);
            if (at >= start && (code === Character.LineFeed || code === Character.CarriageReturn)) {
              let next = at + 1;
              if (code === Character.CarriageReturn) {
                normalized = false;
                if (source.charCodeAt(next) === Character.LineFeed) {
                  next++;
                }
              }
              fields[field++] = start;
              fields[field++] = at;
              fields[field++] = next;
              fields[field++] = 0;
              start = next;
            }
          }
          if (mask1 & 0x800000) {
            const at = cursor + 6;
            const code = source.charCodeAt(at);
            if (at >= start && (code === Character.LineFeed || code === Character.CarriageReturn)) {
              let next = at + 1;
              if (code === Character.CarriageReturn) {
                normalized = false;
                if (source.charCodeAt(next) === Character.LineFeed) {
                  next++;
                }
              }
              fields[field++] = start;
              fields[field++] = at;
              fields[field++] = next;
              fields[field++] = 0;
              start = next;
            }
          }
          if (mask1 & 0x80000000) {
            const at = cursor + 7;
            const code = source.charCodeAt(at);
            if (at >= start && (code === Character.LineFeed || code === Character.CarriageReturn)) {
              let next = at + 1;
              if (code === Character.CarriageReturn) {
                normalized = false;
                if (source.charCodeAt(next) === Character.LineFeed) {
                  next++;
                }
              }
              fields[field++] = start;
              fields[field++] = at;
              fields[field++] = next;
              fields[field++] = 0;
              start = next;
            }
          }
        }
      }
    }
    const tail = limit - cursor || (start < limit ? 1 : 0);
    fields = growLineFields(fields, field + tail * BlockLineField.Stride);
    for (; cursor < limit; cursor++) {
      if (cursor < start) {
        continue;
      }
      const code = source.charCodeAt(cursor);
      let next = cursor + 1;
      if (code === Character.CarriageReturn) {
        normalized = false;
        if (source.charCodeAt(next) === Character.LineFeed) {
          next++;
        }
      }
      else if (code !== Character.LineFeed) {
        continue;
      }
      fields[field++] = start;
      fields[field++] = cursor;
      fields[field++] = next;
      fields[field++] = 0;
      start = next;
    }
    if (start < limit) {
      fields[field++] = start;
      fields[field++] = limit;
      fields[field++] = limit;
      fields[field++] = 0;
    }

    return {
      count: field / BlockLineField.Stride,
      fields,
      normalized,
    };
  }
}

export class BlockLines implements SourceLocator {
  #fields: Int32Array;
  #length = 0;
  #locatorField = 0;
  // Projected views omit source ownership, so a positive length also proves physical contiguity.
  #sourceLength: number;
  // Once false, edits keep this conservative rather than rescanning retained source.
  #normalized = true;

  constructor(sourceLength: number, capacity: number) {
    this.#sourceLength = sourceLength;
    this.#fields = new Int32Array(capacity * BlockLineField.Stride);
  }

  static from(source: string, start: number, limit: number): BlockLines {
    const sourceLength = source.length;
    // Isolate partial ranges so a CR at the limit cannot consume an LF outside the view.
    if (start > 0 || limit < sourceLength) {
      source = source.slice(start, limit);
    }
    // Typical Markdown lines exceed 16 characters; cap the capacity hint at 16,384 lines.
    const lines = new BlockLines(
      sourceLength,
      Math.min((source.length + 15) >>> 4, 16384),
    );
    lines.#length = BlockLines.#scan(source, lines);
    if (start !== 0) {
      lines.#shiftPositions(0, start);
    }
    return lines;
  }

  /** Rebuilds the physical line index while retaining its backing store. */
  scan(source: string): this {
    this.#sourceLength = source.length;
    this.#locatorField = 0;
    const capacity = Math.min((source.length + 15) >>> 4, 16384);
    this.#fields = growLineFields(this.#fields, capacity * BlockLineField.Stride);
    this.#length = BlockLines.#scan(source, this);
    return this;
  }

  /**
   * Fills packed physical lines from a zero-based source segment.
   * Range setup and coordinate rebasing remain in {@link BlockLines.from}, outside this hot loop.
   */
  static #scan(source: string, lines: BlockLines): number {
    const limit = source.length;
    if (limit >= Latin1.minimum && Latin1.prepare(limit)) {
      const { count, fields, normalized } = Latin1.scan(source, lines.#fields);
      lines.#fields = fields;
      lines.#normalized = normalized;
      return count;
    }
    let start = 0;
    let lineFeed = source.indexOf("\n");
    let carriageReturn = source.indexOf("\r");
    lines.#normalized = carriageReturn < 0;
    // Physical lines initialize all packed fields in one sequential write run.
    let field = 0;
    let fields = lines.#fields;
    while (start < limit) {
      // Default to the LF-only path; only CR-bearing input pays for mixed-ending selection.
      let end = lineFeed;
      let next = end + 1;
      if (carriageReturn !== -1 && (end < 0 || carriageReturn < end)) {
        end = carriageReturn;
        next = end + (source.charCodeAt(end + 1) === Character.LineFeed ? 2 : 1);
        carriageReturn = source.indexOf("\r", next);
        if (lineFeed !== -1 && lineFeed < next) {
          lineFeed = source.indexOf("\n", next);
        }
      }
      else if (lineFeed < 0) {
        end = next = limit;
      }
      else {
        lineFeed = source.indexOf("\n", next);
      }
      if (field >= fields.length) {
        lines.#fields = growLineFields(lines.#fields, field + BlockLineField.Stride);
        fields = lines.#fields;
      }
      fields[field++] = start;
      fields[field++] = end;
      fields[field++] = next;
      fields[field++] = 0;
      start = next;
    }
    return field / BlockLineField.Stride;
  }

  get length(): number {
    return this.#length;
  }

  start(index: number): number {
    return this.#fields[index * BlockLineField.Stride + BlockLineField.Start];
  }

  end(index: number): number {
    return this.#fields[index * BlockLineField.Stride + BlockLineField.End];
  }

  next(index: number): number {
    return this.#fields[index * BlockLineField.Stride + BlockLineField.Next];
  }

  prefixColumns(index: number): number {
    return this.#fields[index * BlockLineField.Stride + BlockLineField.State] >>> 1;
  }

  lazy(index: number): boolean {
    return (this.#fields[index * BlockLineField.Stride + BlockLineField.State] & BlockLineState.Lazy) !== 0;
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
      fields[fieldLength - BlockLineField.Stride + BlockLineField.End] < sourceLength
    ) {
      return {
        line: fieldLength / BlockLineField.Stride + 1,
        column: 1,
        offset,
      };
    }
    let field = this.#locatorField;
    let start = fields[field + BlockLineField.Start];
    while (field + BlockLineField.Stride < fieldLength) {
      const nextStart = fields[field + BlockLineField.Stride + BlockLineField.Start];
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
    fields[field + BlockLineField.Start] = start;
    fields[field + BlockLineField.End] = end;
    fields[field + BlockLineField.Next] = next;
    fields[field + BlockLineField.State] = state;
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
    const changed = BlockLines.from(nextSource, restartOffset, newSuffixOffset);
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
      fields[field + BlockLineField.Start] += delta;
      fields[field + BlockLineField.End] += delta;
      fields[field + BlockLineField.Next] += delta;
    }
  }
}

export function lineContentEnd(source: string, start: number, end: number): number {
  if (end <= start) {
    return end;
  }
  if (source.charCodeAt(end - 1) === Character.LineFeed) {
    return end - (
      end > start + 1 && source.charCodeAt(end - 2) === Character.CarriageReturn
        ? 2
        : 1
    );
  }
  return source.charCodeAt(end - 1) === Character.CarriageReturn ? end - 1 : end;
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
