export interface SourceLocation {
  column: number;
  line: number;
  offset: number;
}

export interface SourceSpan {
  end: number;
  start: number;
}

export interface TextEdit extends SourceSpan {
  text: string;
}

interface SourceViewSegment extends SourceSpan {
  viewStart: number;
  viewEnd: number;
}

export interface SourceView {
  readonly text: string;
  mapPoint: (offset: number) => number;
  mapSpan: (start: number, end: number) => SourceSpan;
}

export class ContiguousSourceView implements SourceView {
  #offset: number;
  readonly text: string;

  constructor(source: string, start: number, end: number) {
    validateSourceSpan(start, end, source.length);
    this.#offset = start;
    this.text = source.slice(start, end);
  }

  mapPoint(offset: number): number {
    return this.#offset + offset;
  }

  mapSpan(start: number, end: number): SourceSpan {
    return { start: this.#offset + start, end: this.#offset + end };
  }
}

export class SegmentedSourceView implements SourceView {
  #segments: readonly SourceViewSegment[];
  readonly text: string;

  constructor(source: string, spans: readonly SourceSpan[]) {
    const segments: SourceViewSegment[] = [];
    const parts: string[] = [];
    let viewOffset = 0;
    let previousEnd = 0;
    for (const span of spans) {
      validateSourceSpan(span.start, span.end, source.length);
      if (segments.length > 0 && span.start < previousEnd) {
        throw new RangeError(`Source spans must be ordered and non-overlapping: ${span.start} < ${previousEnd}`);
      }
      if (span.start === span.end) {
        continue;
      }
      const viewEnd = viewOffset + span.end - span.start;
      parts.push(source.slice(span.start, span.end));
      segments.push({ start: span.start, end: span.end, viewStart: viewOffset, viewEnd });
      viewOffset = viewEnd;
      previousEnd = span.end;
    }
    this.#segments = segments;
    this.text = parts.join("");
  }

  mapPoint(offset: number): number {
    if (this.#segments.length === 0) {
      return 0;
    }
    if (offset === this.text.length) {
      return this.#segments[this.#segments.length - 1].end;
    }
    const segment = this.#containingSegment(offset);
    return segment.start + offset - segment.viewStart;
  }

  mapSpan(start: number, end: number): SourceSpan {
    if (this.#segments.length === 0) {
      return { start: 0, end: 0 };
    }
    if (start === end) {
      const point = this.mapPoint(start);
      return { start: point, end: point };
    }
    const first = this.#containingSegment(start);
    const last = this.#containingSegment(end - 1);
    return {
      start: first.start + start - first.viewStart,
      end: last.start + end - last.viewStart,
    };
  }

  #containingSegment(offset: number): SourceViewSegment {
    let low = 0;
    let high = this.#segments.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (offset < this.#segments[middle].viewEnd) {
        high = middle;
      }
      else {
        low = middle + 1;
      }
    }
    return this.#segments[low];
  }
}

function validateSourceSpan(start: number, end: number, sourceLength: number): void {
  if (start < 0 || end < start || end > sourceLength) {
    throw new RangeError(`Invalid source span [${start}, ${end}) for source length ${sourceLength}`);
  }
}
