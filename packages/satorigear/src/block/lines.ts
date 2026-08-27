import { Character } from "../constants/character.ts";
import type { SourceLocation, SourceLocator } from "../source-view.ts";

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

export class BlockLines implements SourceLocator {
  #fieldLength = 0;
  #fields: Int32Array;
  #locatorField = 0;
  // Positions in the retained edit suffix are stored relative to source EOF. Changing
  // source length then shifts the whole suffix without rewriting every line coordinate.
  #relativeStart = Infinity;
  #sourceLength: number;

  constructor(sourceLength = 0, lineCapacity: number = BlockLineCapacity.Initial) {
    this.#sourceLength = sourceLength;
    this.#fields = new Int32Array(lineCapacity * BlockLineField.Stride);
  }

  static from(source: string, start = 0, limit = source.length): BlockLines {
    const sourceLength = source.length;
    // Scan partial ranges in isolation because String#indexOf cannot take an end bound.
    if (start > 0 || limit < sourceLength) {
      source = source.slice(start, limit);
    }
    // Typical Markdown lines exceed 16 characters; cap the capacity hint at 16,384 lines.
    const lines = new BlockLines(
      sourceLength,
      Math.min((source.length + 15) >>> 4, 16384),
    );
    BlockLines.#scan(source, lines);
    if (start !== 0) {
      lines.#shiftPositions(0, start);
    }
    return lines;
  }

  /**
   * Fills packed physical lines from a zero-based source segment.
   *
   * Range setup and coordinate rebasing remain in {@link BlockLines.from}, outside
   * this hot loop.
   */
  static #scan(source: string, lines: BlockLines): void {
    const limit = source.length;
    let start = 0;
    let lineFeed = source.indexOf("\n");
    let carriageReturn = source.indexOf("\r");
    // Physical lines have zero state, so write only their three position fields.
    let field = 0;
    let fields = lines.#fields;
    while (start < limit) {
      // Default to the LF-only path; only CR-bearing input pays for mixed-ending selection.
      let end = lineFeed;
      let next = end + 1;
      if (carriageReturn >= 0 && (end < 0 || carriageReturn < end)) {
        end = carriageReturn;
        next = end + (source.charCodeAt(end + 1) === Character.LineFeed ? 2 : 1);
        carriageReturn = source.indexOf("\r", next);
        if (lineFeed < next) {
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
        lines.#ensureCapacity(field + BlockLineField.Stride);
        fields = lines.#fields;
      }
      fields[field + BlockLineField.Start] = start;
      fields[field + BlockLineField.End] = end;
      fields[field + BlockLineField.Next] = next;
      field += BlockLineField.Stride;
      start = next;
    }
    lines.#fieldLength = field;
  }

  get length(): number {
    return this.#fieldLength / BlockLineField.Stride;
  }

  start(index: number): number {
    return this.#position(this.#fields[index * BlockLineField.Stride + BlockLineField.Start]);
  }

  end(index: number): number {
    return this.#position(this.#fields[index * BlockLineField.Stride + BlockLineField.End]);
  }

  next(index: number): number {
    return this.#position(this.#fields[index * BlockLineField.Stride + BlockLineField.Next]);
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

  /**
   * After {@link locator} resets the monotonic cursor, this stable method keeps projection
   * monomorphic across documents; per-parse closures would invalidate its optimized call target.
   */
  locationAt(offset: number): SourceLocation {
    const fieldLength = this.#fieldLength;
    if (fieldLength === 0) {
      return { line: 1, column: 1, offset };
    }
    const fields = this.#fields;
    const sourceLength = this.#sourceLength;
    if (
      offset === sourceLength &&
      this.#position(fields[fieldLength - BlockLineField.Stride + BlockLineField.End]) < sourceLength
    ) {
      return {
        line: fieldLength / BlockLineField.Stride + 1,
        column: 1,
        offset,
      };
    }
    let field = this.#locatorField;
    let start = this.#position(fields[field + BlockLineField.Start]);
    while (field + BlockLineField.Stride < fieldLength) {
      const nextStart = this.#position(
        fields[field + BlockLineField.Stride + BlockLineField.Start],
      );
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

  push(
    start: number,
    end: number,
    next: number,
    prefixColumns = 0,
    lazy = false,
  ): void {
    const field = this.#fieldLength;
    let fields = this.#fields;
    if (field >= fields.length) {
      this.#ensureCapacity(field + BlockLineField.Stride);
      fields = this.#fields;
    }
    const state = prefixColumns * 2 + (lazy ? BlockLineState.Lazy : 0);
    fields[field + BlockLineField.Start] = start;
    fields[field + BlockLineField.End] = end;
    fields[field + BlockLineField.Next] = next;
    fields[field + BlockLineField.State] = state;
    this.#fieldLength += BlockLineField.Stride;
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
    this.#fieldLength = 0;
    this.#relativeStart = Infinity;
    this.push(start, end, next, prefixColumns, lazy);
  }

  slice(start = 0, end = this.length): BlockLines {
    // The exact slice supplies its own backing store, so skip the default capacity.
    const result = new BlockLines(this.#sourceLength, 0);
    const fieldStart = start * BlockLineField.Stride;
    const fieldEnd = end * BlockLineField.Stride;
    result.#fields = this.#fields.slice(fieldStart, fieldEnd);
    result.#fieldLength = fieldEnd - fieldStart;
    if (this.#relativeStart < end) {
      result.#relativeStart = Math.max(0, this.#relativeStart - start);
    }
    return result;
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
      const next = this.slice();
      for (let index = 0; index < changed.length; index++) {
        next.#setAbsoluteFrom(prefixEnd + index, changed, index);
      }
      return next;
    }
    const next = new BlockLines(
      nextSource.length,
      prefixEnd + changed.length + this.length - suffix,
    );
    // Reassemble an absolute prefix and rebuilt window with an EOF-relative stable suffix.
    next.#appendAbsoluteRange(this, 0, prefixEnd);
    next.#appendRawRange(changed, 0, changed.length);
    next.#appendRelativeRange(this, suffix);
    return next;
  }

  pop(): void {
    if (this.#fieldLength > 0) {
      this.#fieldLength -= BlockLineField.Stride;
      // A boundary at or beyond the new end means no EOF-relative lines remain.
      if (this.#relativeStart >= this.length) {
        this.#relativeStart = Infinity;
      }
    }
  }

  /** Copies an absolute-coordinate line while preserving the target slot's encoding. */
  #setAbsoluteFrom(index: number, lines: BlockLines, line: number): void {
    const field = index * BlockLineField.Stride;
    const sourceField = line * BlockLineField.Stride;
    const shift = index >= this.#relativeStart ? -this.#sourceLength - 1 : 0;
    this.#fields[field + BlockLineField.Start] = lines.#fields[sourceField + BlockLineField.Start] + shift;
    this.#fields[field + BlockLineField.End] = lines.#fields[sourceField + BlockLineField.End] + shift;
    this.#fields[field + BlockLineField.Next] = lines.#fields[sourceField + BlockLineField.Next] + shift;
    this.#fields[field + BlockLineField.State] = lines.#fields[sourceField + BlockLineField.State];
  }

  /** Appends a range in absolute source coordinates. */
  #appendAbsoluteRange(lines: BlockLines, start: number, end: number): void {
    const boundary = Math.max(start, Math.min(end, lines.#relativeStart));
    this.#appendRawRange(lines, start, boundary);
    const relativeStart = this.length;
    this.#appendRawRange(lines, boundary, end);
    this.#shiftPositions(relativeStart, lines.#sourceLength + 1);
  }

  /** Appends an EOF-relative suffix whose coordinates follow future source-length changes. */
  #appendRelativeRange(lines: BlockLines, start = 0, end = lines.length): void {
    this.#relativeStart = this.length;
    const boundary = Math.max(start, Math.min(end, lines.#relativeStart));
    const absoluteStart = this.length;
    this.#appendRawRange(lines, start, boundary);
    this.#shiftPositions(absoluteStart, -lines.#sourceLength - 1);
    this.#appendRawRange(lines, boundary, end);
  }

  /** Appends stored fields unchanged; their coordinate encoding must already match the target. */
  #appendRawRange(lines: BlockLines, start: number, end: number): void {
    if (start >= end) {
      return;
    }
    const sourceStart = start * BlockLineField.Stride;
    const sourceEnd = end * BlockLineField.Stride;
    const targetStart = this.#fieldLength;
    const targetEnd = targetStart + sourceEnd - sourceStart;
    this.#ensureCapacity(targetEnd);
    this.#fields.set(lines.#fields.subarray(sourceStart, sourceEnd), targetStart);
    this.#fieldLength = targetEnd;
  }

  #ensureCapacity(fieldLength: number): void {
    const fields = this.#fields;
    if (fieldLength <= fields.length) {
      return;
    }
    let lineCapacity = fields.length / BlockLineField.Stride;
    const requiredLines = fieldLength / BlockLineField.Stride;
    // Allocate four lines initially, double through 16, then grow by 50%.
    while (lineCapacity < requiredLines) {
      lineCapacity += lineCapacity < BlockLineCapacity.DoublingLimit
        ? Math.max(BlockLineCapacity.Initial, lineCapacity)
        : lineCapacity >>> 1;
    }
    const nextFields = new Int32Array(lineCapacity * BlockLineField.Stride);
    nextFields.set(fields);
    this.#fields = nextFields;
  }

  #position(position: number): number {
    return position < 0 ? position + this.#sourceLength + 1 : position;
  }

  #shiftPositions(start: number, delta: number): void {
    const fields = this.#fields;
    const fieldLength = this.#fieldLength;
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

export function indentColumns(source: string, lines: BlockLines, index: number): number {
  let offset = lines.start(index);
  let columns = lines.prefixColumns(index);
  const end = lines.end(index);
  while (offset < end) {
    if (source[offset] === " ") {
      offset++;
      columns++;
      continue;
    }
    if (source[offset] === "\t") {
      offset++;
      columns += 4 - (columns % 4);
      continue;
    }
    break;
  }
  return columns;
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
 * Unlike {@link indentOffset}, returns -1 when the logical indent exceeds three columns.
 * Inlining the scan improves repeated large-document block-dispatch throughput.
 */
export function lineIndentOffset(source: string, lines: BlockLines, index: number): number {
  let offset = lines.start(index);
  const limit = offset + 3 - lines.prefixColumns(index);
  const end = lines.end(index);
  while (offset < end && offset < limit && source.charCodeAt(offset) === Character.Space) {
    offset++;
  }
  if (offset > limit) {
    return -1;
  }
  const code = source.charCodeAt(offset);
  return code === Character.Space || code === Character.CharacterTabulation
    ? -1
    : offset;
}

export function isBlank(source: string, lines: BlockLines, index: number): boolean {
  for (let offset = lines.start(index), end = lines.end(index); offset < end; offset++) {
    const code = source.charCodeAt(offset);
    if (code !== Character.Space && code !== Character.CharacterTabulation) {
      return false;
    }
  }
  return true;
}

export function physicalColumnAt(source: string, offset: number): number {
  let start = offset;
  while (start > 0 && source[start - 1] !== "\n" && source[start - 1] !== "\r") {
    start--;
  }
  let column = 0;
  while (start < offset) {
    column += source[start] === "\t" ? 4 - (column % 4) : 1;
    start++;
  }
  return column;
}

export function logicalLine(source: string, lines: BlockLines, index: number): string {
  const prefixColumns = lines.prefixColumns(index);
  let result = " ".repeat(prefixColumns);
  let offset = lines.start(index);
  let logicalColumn = prefixColumns;
  let physicalColumn = physicalColumnAt(source, offset);
  const end = lines.end(index);
  while (offset < end && logicalColumn < 4 && (source[offset] === " " || source[offset] === "\t")) {
    if (source[offset] === " ") {
      result += " ";
      logicalColumn++;
      physicalColumn++;
    }
    else {
      const logicalWidth = 4 - (logicalColumn % 4);
      const physicalWidth = 4 - (physicalColumn % 4);
      result += "\t" + " ".repeat(Math.max(0, physicalWidth - logicalWidth));
      logicalColumn += Math.max(logicalWidth, physicalWidth);
      physicalColumn += physicalWidth;
    }
    offset++;
  }
  return result + source.slice(offset, lines.next(index));
}

export function contentAfterColumns(
  source: string,
  lines: BlockLines,
  index: number,
  columns: number,
): { offset: number; prefixColumns: number } | undefined {
  let offset = lines.start(index);
  let consumed = lines.prefixColumns(index);
  const end = lines.end(index);
  while (offset < end && consumed < columns) {
    if (source[offset] === " ") {
      consumed++;
    }
    else if (source[offset] === "\t") {
      consumed += 4 - (consumed % 4);
    }
    else {
      break;
    }
    offset++;
  }
  if (consumed >= columns) {
    return { offset, prefixColumns: consumed - columns };
  }
}

export function normalizeLines(value: string): string {
  return value.includes("\r") ? value.replace(/\r\n|\r/g, "\n") : value;
}

export function removeIndent(value: string, columns: number): string {
  let offset = 0;
  let consumed = 0;
  while (offset < value.length && consumed < columns) {
    if (value[offset] === " ") {
      consumed++;
    }
    else if (value[offset] === "\t") {
      consumed += 4 - (consumed % 4);
    }
    else {
      break;
    }
    offset++;
  }
  return " ".repeat(Math.max(0, consumed - columns)) + value.slice(offset);
}
