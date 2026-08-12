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

export interface SourceViewSegment extends SourceSpan {
  viewStart: number;
  viewEnd: number;
}

// Shared functions remain own methods because prototype dispatch measurably slows parsing.
export interface SourceView {
  readonly text: string;
  readonly segments: readonly SourceViewSegment[];
  mapPoint: (offset: number) => number;
  mapSpan: (start: number, end: number) => SourceSpan;
}

function containingSegment(view: SourceView, offset: number): number {
  let low = 0;
  let high = view.segments.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (offset < view.segments[middle].viewEnd) {
      high = middle;
    }
    else {
      low = middle + 1;
    }
  }
  return low;
}

function validateSpan(view: SourceView, start: number, end: number): void {
  if (start < 0 || end < start || end > view.text.length) {
    throw new RangeError(`Invalid source-view span [${start}, ${end}) for length ${view.text.length}`);
  }
}

function validateSourceSpan(span: SourceSpan, sourceLength: number): void {
  if (span.start < 0 || span.end < span.start || span.end > sourceLength) {
    throw new RangeError(`Invalid source span [${span.start}, ${span.end}) for source length ${sourceLength}`);
  }
}

function mapPoint(this: SourceView, offset: number): number {
  if (offset < 0 || offset > this.text.length) {
    throw new RangeError(`Invalid source-view offset ${offset} for length ${this.text.length}`);
  }
  if (this.segments.length === 0) {
    return 0;
  }
  if (offset === this.text.length) {
    return this.segments[this.segments.length - 1].end;
  }
  const segment = this.segments[containingSegment(this, offset)];
  return segment.start + offset - segment.viewStart;
}

function mapSpan(this: SourceView, start: number, end: number): SourceSpan {
  validateSpan(this, start, end);
  if (this.segments.length === 0) {
    return { start: 0, end: 0 };
  }
  if (this.segments.length === 1) {
    const segment = this.segments[0];
    const sourceStart = segment.start + start - segment.viewStart;
    return { start: sourceStart, end: sourceStart + end - start };
  }
  if (start === end) {
    const point = this.mapPoint(start);
    return { start: point, end: point };
  }
  const first = this.segments[containingSegment(this, start)];
  const last = this.segments[containingSegment(this, end - 1)];
  return {
    start: first.start + start - first.viewStart,
    end: last.start + end - last.viewStart,
  };
}

// Build logical text from physical source spans while preserving original coordinates.
export function createSourceView(source: string, spans: readonly SourceSpan[]): SourceView {
  if (spans.length === 1) {
    // Contiguous regions dominate; avoid the parts array and join on their hot path.
    const span = spans[0];
    validateSourceSpan(span, source.length);
    if (span.start === span.end) {
      return { text: "", segments: [], mapPoint, mapSpan };
    }
    const length = span.end - span.start;
    return {
      text: source.slice(span.start, span.end),
      segments: [{ start: span.start, end: span.end, viewStart: 0, viewEnd: length }],
      mapPoint,
      mapSpan,
    };
  }

  const segments: SourceViewSegment[] = [];
  const parts: string[] = [];
  let viewOffset = 0;
  let previousEnd = 0;

  for (const span of spans) {
    validateSourceSpan(span, source.length);
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

  return { text: parts.join(""), segments, mapPoint, mapSpan };
}
