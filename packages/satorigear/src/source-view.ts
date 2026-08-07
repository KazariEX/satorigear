export interface SourceRange {
  offset: number;
  end: number;
}

export interface SourceEdit {
  end: number;
  start: number;
  text: string;
}

export interface SourceViewSegment extends SourceRange {
  viewOffset: number;
  viewEnd: number;
}

export interface SourceView {
  text: string;
  segments: readonly SourceViewSegment[];
  mapPoint: (offset: number) => number;
  mapRange: (offset: number, end: number) => SourceRange[];
}

/** Project document edits into a view whose physical segments remain structurally stable. */
export function projectSourceEdits(
  previous: SourceView,
  next: SourceView,
  edits: readonly SourceEdit[],
): SourceEdit[] | null {
  if (previous.segments.length !== next.segments.length) {
    return null;
  }

  const projected: SourceEdit[] = [];
  let editIndex = 0;
  let documentDelta = 0;
  let viewDelta = 0;
  for (let segmentIndex = 0; segmentIndex < previous.segments.length; segmentIndex++) {
    const oldSegment = previous.segments[segmentIndex];
    const newSegment = next.segments[segmentIndex];
    if (newSegment.offset !== oldSegment.offset + documentDelta
      || newSegment.viewOffset !== oldSegment.viewOffset + viewDelta) {
      return null;
    }

    while (editIndex < edits.length && edits[editIndex].start < oldSegment.end) {
      const edit = edits[editIndex++];
      if (edit.start <= oldSegment.offset || edit.end >= oldSegment.end) {
        return null;
      }
      projected.push({
        start: oldSegment.viewOffset + edit.start - oldSegment.offset + viewDelta,
        end: oldSegment.viewOffset + edit.end - oldSegment.offset + viewDelta,
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

/** Build logical text from physical source ranges while preserving original coordinates. */
export function createSourceView(source: string, ranges: readonly SourceRange[]): SourceView {
  const segments: SourceViewSegment[] = [];
  const parts: string[] = [];
  let viewOffset = 0;
  let previousEnd = 0;

  for (const range of ranges) {
    if (!Number.isInteger(range.offset) || !Number.isInteger(range.end)
      || range.offset < 0 || range.end < range.offset || range.end > source.length) {
      throw new Error(`Invalid source range [${range.offset}, ${range.end}) for source length ${source.length}`);
    }
    if (segments.length > 0 && range.offset < previousEnd) {
      throw new Error(`Source ranges must be ordered and non-overlapping: ${range.offset} < ${previousEnd}`);
    }
    if (range.offset === range.end) {
      continue;
    }

    const viewEnd = viewOffset + range.end - range.offset;
    parts.push(source.slice(range.offset, range.end));
    segments.push({ offset: range.offset, end: range.end, viewOffset, viewEnd });
    viewOffset = viewEnd;
    previousEnd = range.end;
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
    return segment.offset + offset - segment.viewOffset;
  }

  function mapRange(offset: number, end: number): SourceRange[] {
    if (!Number.isInteger(offset) || !Number.isInteger(end)
      || offset < 0 || end < offset || end > text.length) {
      throw new Error(`Invalid source-view range [${offset}, ${end}) for length ${text.length}`);
    }
    if (offset === end) {
      return [];
    }

    const mapped: SourceRange[] = [];
    for (let index = containingSegment(offset); index < segments.length; index++) {
      const segment = segments[index];
      if (segment.viewOffset >= end) {
        break;
      }
      const viewStart = Math.max(offset, segment.viewOffset);
      const viewEnd = Math.min(end, segment.viewEnd);
      const next = {
        offset: segment.offset + viewStart - segment.viewOffset,
        end: segment.offset + viewEnd - segment.viewOffset,
      };
      const previous = mapped[mapped.length - 1];
      if (previous?.end === next.offset) {
        previous.end = next.end;
      }
      else {
        mapped.push(next);
      }
    }
    return mapped;
  }

  return { text, segments, mapPoint, mapRange };
}
