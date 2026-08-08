import type { TextEdit } from "./text-edit.ts";

export interface SourceLocation {
  column: number;
  line: number;
  offset: number;
}

export interface SourceSpan {
  end: number;
  start: number;
}

export interface SourceViewSegment extends SourceSpan {
  viewStart: number;
  viewEnd: number;
}

// Shared functions remain own methods because prototype dispatch measurably slows small-document parsing.
export interface SourceView {
  readonly text: string;
  readonly segments: readonly SourceViewSegment[];
  mapPoint: (offset: number) => number;
  mapSpan: (start: number, end: number) => SourceSpan;
  mapSpans: (start: number, end: number) => SourceSpan[];
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
  if (!Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end < start || end > view.text.length) {
    throw new Error(`Invalid source-view span [${start}, ${end}) for length ${view.text.length}`);
  }
}

function validateSourceSpan(span: SourceSpan, sourceLength: number): void {
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end)
    || span.start < 0 || span.end < span.start || span.end > sourceLength) {
    throw new Error(`Invalid source span [${span.start}, ${span.end}) for source length ${sourceLength}`);
  }
}

function mapPoint(this: SourceView, offset: number): number {
  if (!Number.isInteger(offset) || offset < 0 || offset > this.text.length) {
    throw new Error(`Invalid source-view offset ${offset} for length ${this.text.length}`);
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

function mapSpans(this: SourceView, start: number, end: number): SourceSpan[] {
  validateSpan(this, start, end);
  if (start === end) {
    return [];
  }

  const mapped: SourceSpan[] = [];
  for (let index = containingSegment(this, start); index < this.segments.length; index++) {
    const segment = this.segments[index];
    if (segment.viewStart >= end) {
      break;
    }
    const viewStart = Math.max(start, segment.viewStart);
    const viewEnd = Math.min(end, segment.viewEnd);
    const next = {
      start: segment.start + viewStart - segment.viewStart,
      end: segment.start + viewEnd - segment.viewStart,
    };
    const previous = mapped[mapped.length - 1];
    if (previous?.end === next.start) {
      previous.end = next.end;
    }
    else {
      mapped.push(next);
    }
  }
  return mapped;
}

// Project document edits into a view whose physical segments remain structurally stable.
export function projectSourceEdits(
  previous: SourceView,
  next: SourceView,
  edits: readonly TextEdit[],
): TextEdit[] | null {
  if (previous.segments.length !== next.segments.length) {
    return null;
  }

  const projected: TextEdit[] = [];
  let editIndex = 0;
  let documentDelta = 0;
  let viewDelta = 0;
  for (let segmentIndex = 0; segmentIndex < previous.segments.length; segmentIndex++) {
    const oldSegment = previous.segments[segmentIndex];
    const newSegment = next.segments[segmentIndex];
    if (newSegment.start !== oldSegment.start + documentDelta
      || newSegment.viewStart !== oldSegment.viewStart + viewDelta) {
      return null;
    }

    while (editIndex < edits.length && edits[editIndex].start < oldSegment.end) {
      const edit = edits[editIndex++];
      if (edit.start <= oldSegment.start || edit.end >= oldSegment.end) {
        return null;
      }
      projected.push({
        start: oldSegment.viewStart + edit.start - oldSegment.start + viewDelta,
        end: oldSegment.viewStart + edit.end - oldSegment.start + viewDelta,
        text: edit.text,
      });
      const delta = edit.text.length - (edit.end - edit.start);
      documentDelta += delta;
      viewDelta += delta;
    }

    if (newSegment.end !== oldSegment.end + documentDelta
      || newSegment.viewEnd !== oldSegment.viewEnd + viewDelta) {
      return null;
    }
  }
  return editIndex === edits.length ? projected : null;
}

// Build logical text from physical source spans while preserving original coordinates.
export function createSourceView(source: string, spans: readonly SourceSpan[]): SourceView {
  if (spans.length === 1) {
    const span = spans[0];
    validateSourceSpan(span, source.length);
    if (span.start === span.end) {
      return { text: "", segments: [], mapPoint, mapSpan, mapSpans };
    }
    const length = span.end - span.start;
    return {
      text: source.slice(span.start, span.end),
      segments: [{ start: span.start, end: span.end, viewStart: 0, viewEnd: length }],
      mapPoint,
      mapSpan,
      mapSpans,
    };
  }

  const segments: SourceViewSegment[] = [];
  const parts: string[] = [];
  let viewOffset = 0;
  let previousEnd = 0;

  for (const span of spans) {
    validateSourceSpan(span, source.length);
    if (segments.length > 0 && span.start < previousEnd) {
      throw new Error(`Source spans must be ordered and non-overlapping: ${span.start} < ${previousEnd}`);
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

  return { text: parts.join(""), segments, mapPoint, mapSpan, mapSpans };
}
