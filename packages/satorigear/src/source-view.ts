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

export interface SourceView {
  text: string;
  segments: readonly SourceViewSegment[];
  mapPoint: (offset: number) => number;
  mapSpan: (start: number, end: number) => SourceSpan;
  mapSpans: (start: number, end: number) => SourceSpan[];
}

/** Project document edits into a view whose physical segments remain structurally stable. */
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

/** Build logical text from physical source spans while preserving original coordinates. */
export function createSourceView(source: string, spans: readonly SourceSpan[]): SourceView {
  const segments: SourceViewSegment[] = [];
  const parts: string[] = [];
  let viewOffset = 0;
  let previousEnd = 0;

  for (const span of spans) {
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end)
      || span.start < 0 || span.end < span.start || span.end > source.length) {
      throw new Error(`Invalid source span [${span.start}, ${span.end}) for source length ${source.length}`);
    }
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

  const text = parts.join("");

  function containingSegment(offset: number): number {
    let low = 0;
    let high = segments.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (offset < segments[middle].viewEnd) {
        high = middle;
      }
      else {
        low = middle + 1;
      }
    }
    return low;
  }

  function mapPoint(offset: number): number {
    if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
      throw new Error(`Invalid source-view offset ${offset} for length ${text.length}`);
    }
    if (segments.length === 0) {
      return 0;
    }
    if (offset === text.length) {
      return segments[segments.length - 1].end;
    }
    const segment = segments[containingSegment(offset)];
    return segment.start + offset - segment.viewStart;
  }

  function validateSpan(start: number, end: number): void {
    if (!Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || end < start || end > text.length) {
      throw new Error(`Invalid source-view span [${start}, ${end}) for length ${text.length}`);
    }
  }

  function mapSpans(start: number, end: number): SourceSpan[] {
    validateSpan(start, end);
    if (start === end) {
      return [];
    }

    const mapped: SourceSpan[] = [];
    for (let index = containingSegment(start); index < segments.length; index++) {
      const segment = segments[index];
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

  function mapSpan(start: number, end: number): SourceSpan {
    validateSpan(start, end);
    if (segments.length === 0) {
      return { start: 0, end: 0 };
    }
    if (start === end) {
      const point = mapPoint(start);
      return { start: point, end: point };
    }
    const first = segments[containingSegment(start)];
    const last = segments[containingSegment(end - 1)];
    return {
      start: first.start + start - first.viewStart,
      end: last.start + end - last.viewStart,
    };
  }

  return { text, segments, mapPoint, mapSpan, mapSpans };
}
