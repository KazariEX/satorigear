import { type BlockLines, isBlankLine, trimLineWhitespaceStart } from "../../block/lines.ts";
import { BlockKind } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { normalizeIdentifier, semanticText } from "../utils.ts";
import type { BlockStart } from "../../block/profile.ts";
import type { BlockScanContext } from "../../block/scanner.ts";
import type { SyntaxFeature } from "../types.ts";

interface LinkDefinitionFields {
  destination: string;
  label: string;
  title: string | undefined;
}

interface LabelMatch {
  label: string;
  lineIndex: number;
  offset: number;
}

interface TitleMatch {
  endLine: number;
  title: string | undefined;
}

const labelHead = /[^[\]\\\r\n]*/y;
const destinationHead = /[^\\() \t\r\n]+/y;

function titleCloser(code: number): number {
  return code === Character.LeftParenthesis
    ? Character.RightParenthesis
    : code === Character.QuotationMark || code === Character.Apostrophe
      ? code
      : 0;
}

function scanMultilineLabel(
  source: string,
  lines: BlockLines,
  startIndex: number,
  labelStart: number,
  offset: number,
  context: BlockScanContext,
): LabelMatch | undefined {
  let lineIndex = startIndex;
  let label = "";
  let labelLength = offset - labelStart;
  if (labelLength > 999) {
    return;
  }
  let labelHasContent = trimLineWhitespaceStart(source, labelStart, offset) < offset;

  while (true) {
    const lineEnd = lines.end(lineIndex);
    while (offset < lineEnd) {
      const code = source.charCodeAt(offset);
      if (code === Character.ReverseSolidus && offset + 1 < lineEnd) {
        labelHasContent = true;
        labelLength += 2;
        offset += 2;
        continue;
      }
      if (code === Character.LeftSquareBracket) {
        return;
      }
      if (code === Character.RightSquareBracket) {
        if (source.charCodeAt(offset + 1) === Character.Colon && labelHasContent) {
          return {
            label: label + source.slice(labelStart, offset),
            lineIndex,
            offset: offset + 2,
          };
        }
        return;
      }
      if (code !== Character.Space && code !== Character.CharacterTabulation) {
        labelHasContent = true;
      }
      if (++labelLength > 999) {
        return;
      }
      offset++;
    }
    const nextLine = lineIndex + 1;
    context.retainLookahead(nextLine < lines.length ? lines.end(nextLine) : lines.next(lineIndex));
    if (nextLine >= lines.length || isBlankLine(source, lines, nextLine) || ++labelLength > 999) {
      return;
    }
    label += source.slice(labelStart, lines.next(lineIndex));
    lineIndex = nextLine;
    offset = lines.start(lineIndex);
    labelStart = offset;
  }
}

function scanAngleDestination(source: string, start: number, lineEnd: number): number {
  let offset = start + 1;
  let code = source.charCodeAt(offset);
  while (offset < lineEnd && code !== Character.GreaterThanSign) {
    if (code === Character.LessThanSign) {
      return -1;
    }
    offset += code === Character.ReverseSolidus && offset + 1 < lineEnd ? 2 : 1;
    code = source.charCodeAt(offset);
  }
  if (code !== Character.GreaterThanSign) {
    return -1;
  }
  const end = offset + 1;
  if (end < lineEnd) {
    const trailing = source.charCodeAt(end);
    if (trailing !== Character.Space && trailing !== Character.CharacterTabulation) {
      return -1;
    }
  }
  return end;
}

function scanBalancedDestination(
  source: string,
  start: number,
  offset: number,
  lineEnd: number,
): number {
  let depth = 0;
  while (offset < lineEnd) {
    const code = source.charCodeAt(offset);
    if (code === Character.Space || code === Character.CharacterTabulation) {
      break;
    }
    if (code === Character.ReverseSolidus && offset + 1 < lineEnd) {
      offset += 2;
      continue;
    }
    if (code === Character.LeftParenthesis) {
      if (++depth > 32) {
        return -1;
      }
    }
    else if (code === Character.RightParenthesis && --depth < 0) {
      return -1;
    }
    offset++;
  }
  return offset > start && depth === 0 ? offset : -1;
}

function scanTitle(
  source: string,
  lines: BlockLines,
  destinationLine: number,
  lineIndex: number,
  offset: number,
  closer: number,
  titleOnNextLine: boolean,
  context: BlockScanContext,
): TitleMatch | undefined {
  offset++;
  let title = "";
  let titleStart = offset;
  let lineEnd = lines.end(lineIndex);
  let closed = false;

  while (lineIndex < lines.length) {
    lineEnd = lines.end(lineIndex);
    while (offset < lineEnd) {
      const code = source.charCodeAt(offset);
      if (code === Character.ReverseSolidus && offset + 1 < lineEnd) {
        offset += 2;
        continue;
      }
      if (code === closer) {
        title += source.slice(titleStart, offset);
        offset++;
        closed = true;
        break;
      }
      offset++;
    }
    if (closed) {
      break;
    }
    const nextLine = lineIndex + 1;
    const lookahead = nextLine < lines.length ? lines.end(nextLine) : lines.next(lineIndex);
    if (!titleOnNextLine || lookahead > lines.next(destinationLine + 1)) {
      context.retainLookahead(lookahead);
    }
    if (nextLine >= lines.length || isBlankLine(source, lines, nextLine)) {
      break;
    }
    title += source.slice(titleStart, lines.next(lineIndex));
    lineIndex = nextLine;
    offset = lines.start(lineIndex);
    titleStart = offset;
  }

  if (closed && trimLineWhitespaceStart(source, offset, lineEnd) === lineEnd) {
    return {
      title,
      endLine: lineIndex + 1,
    };
  }
  if (titleOnNextLine) {
    return {
      title: void 0,
      endLine: destinationLine + 1,
    };
  }
}

const linkDefinitionStart: BlockStart = (source, lines, tokens, start, contentOffset, context) => {
  const labelStart = contentOffset + 1;
  const firstLineEnd = lines.end(start);
  labelHead.lastIndex = labelStart;
  labelHead.test(source);
  const stop = labelHead.lastIndex;

  let label: string;
  let lineIndex = start;
  let offset: number;
  const stopCode = stop < firstLineEnd ? source.charCodeAt(stop) : 0;
  if (stopCode === Character.RightSquareBracket) {
    if (
      source.charCodeAt(stop + 1) !== Character.Colon ||
      stop - labelStart > 999 ||
      trimLineWhitespaceStart(source, labelStart, stop) === stop
    ) {
      return;
    }
    label = source.slice(labelStart, stop);
    offset = stop + 2;
  }
  else {
    if (stopCode === Character.LeftSquareBracket) {
      return;
    }
    const match = scanMultilineLabel(
      source,
      lines,
      start,
      labelStart,
      Math.min(stop, firstLineEnd),
      context,
    );
    if (!match) {
      return;
    }
    label = match.label;
    lineIndex = match.lineIndex;
    offset = match.offset;
  }

  let lineEnd = lines.end(lineIndex);
  offset = trimLineWhitespaceStart(source, offset, lineEnd);
  if (offset === lineEnd) {
    const nextLine = lineIndex + 1;
    context.retainLookahead(nextLine < lines.length ? lines.end(nextLine) : lines.next(lineIndex));
    if (nextLine >= lines.length || isBlankLine(source, lines, nextLine)) {
      return;
    }
    lineIndex = nextLine;
    lineEnd = lines.end(lineIndex);
    offset = trimLineWhitespaceStart(source, lines.start(lineIndex), lineEnd);
  }

  let destination: string;
  if (source.charCodeAt(offset) === Character.LessThanSign) {
    const end = scanAngleDestination(source, offset, lineEnd);
    if (end < 0) {
      return;
    }
    destination = source.slice(offset + 1, end - 1);
    offset = end;
  }
  else {
    destinationHead.lastIndex = offset;
    let end = destinationHead.test(source) ? Math.min(destinationHead.lastIndex, lineEnd) : offset;
    if (end < lineEnd) {
      const code = source.charCodeAt(end);
      if (code !== Character.Space && code !== Character.CharacterTabulation) {
        end = scanBalancedDestination(source, offset, end, lineEnd);
      }
    }
    if (end <= offset) {
      return;
    }
    destination = source.slice(offset, end);
    offset = end;
  }

  const destinationLine = lineIndex;
  offset = trimLineWhitespaceStart(source, offset, lineEnd);
  let titleOnNextLine = false;
  if (offset === lineEnd && lineIndex + 1 < lines.length) {
    lineIndex++;
    lineEnd = lines.end(lineIndex);
    offset = trimLineWhitespaceStart(source, lines.start(lineIndex), lineEnd);
    titleOnNextLine = true;
  }

  let title: string | undefined;
  let endLine = destinationLine + 1;
  const closer = titleCloser(source.charCodeAt(offset));
  if (closer) {
    const match = scanTitle(
      source,
      lines,
      destinationLine,
      lineIndex,
      offset,
      closer,
      titleOnNextLine,
      context,
    );
    if (!match) {
      return;
    }
    title = match.title;
    endLine = match.endLine;
  }

  // One leaf owns the whole definition, so the trailing newline stays implicit.
  tokens.push(BlockKind.LinkDefinition, contentOffset, lines.end(endLine - 1), {
    definitionKey: normalizeIdentifier(label),
    value: {
      destination,
      label,
      title,
    } satisfies LinkDefinitionFields,
  });
  return endLine;
};

export const feature: SyntaxFeature = {
  block: {
    builds: [
      {
        token: BlockKind.LinkDefinition,
        build(tokenStart, context) {
          const tokens = context.structure.tokens;
          // This rule only builds leaves emitted with their parsed definition metadata.
          const fields = tokens.value<LinkDefinitionFields>(tokenStart)!;
          const definitionKey = tokens.definitionKey(tokenStart)!;
          return {
            type: "definition",
            identifier: definitionKey,
            label: semanticText(fields.label),
            url: semanticText(fields.destination),
            title: fields.title === void 0 ? null : semanticText(fields.title),
            position: context.locator.positionAt(
              tokens.start(tokenStart),
              tokens.contentEnd(context.source, tokenStart),
            ),
          };
        },
      },
    ],
    starts: [
      {
        codes: [
          Character.LeftSquareBracket,
        ],
        start: linkDefinitionStart,
      },
    ],
  },
};
