import { type BlockLine, firstLineIndexAtOrAfter, indentOf, isBlank } from "../../block/lines.ts";
import { BlockKind, BlockRule } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { blockEnd } from "../../fragment/block.ts";
import {
  appendInlineToken,
  copyInlineToken,
  inlineTokenCount,
  inlineTokenEnd,
  inlineTokenFlags,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
} from "../../inline/tokens.ts";
import { normalizeAssociationLabel } from "../utils.ts";
import { semanticText } from "./text.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
import type { InlineResolutionContext } from "../../inline/profile.ts";
import type { SyntaxFeature } from "../types.ts";

interface LinkDefinitionFields {
  definitionKey: string;
  destination: string;
  label: string;
  markerOffset: number;
  title: string | undefined;
}

interface LinkDefinitionMatch {
  end: number;
  fields: LinkDefinitionFields;
}

function linkDefinitionFields(tokens: BlockTokenStream, token: number): LinkDefinitionFields {
  const fields = tokens.value<LinkDefinitionFields>(token);
  if (tokens.kind(token) !== BlockKind.LinkDefinitionOpen || !fields) {
    throw new Error("Expected LinkDefinitionOpen token to contain parsed fields");
  }
  return fields;
}

function linkDefinitionAt(
  source: string,
  lines: readonly BlockLine[],
  startIndex: number,
  contentOffset: number,
): LinkDefinitionMatch | undefined {
  let lineIndex = startIndex;
  let offset = contentOffset + 1;
  let label = "";
  let labelLength = 0;
  let labelHasContent = false;
  let labelStart = offset;

  scanLabel: while (true) {
    const line = lines[lineIndex];
    while (offset < line.end) {
      const code = source.charCodeAt(offset);
      if (code === Character.ReverseSolidus && offset + 1 < line.end) {
        labelHasContent = true;
        labelLength += 2;
        offset += 2;
        continue;
      }
      if (code === Character.LeftSquareBracket) {
        return;
      }
      if (code === Character.RightSquareBracket && source.charCodeAt(offset + 1) === Character.Colon) {
        break scanLabel;
      }
      if (code !== Character.Space && code !== Character.CharacterTabulation) {
        labelHasContent = true;
      }
      if (++labelLength > 999) {
        return;
      }
      offset++;
    }
    if (lineIndex + 1 >= lines.length || isBlank(source, lines[lineIndex + 1])) {
      return;
    }
    if (++labelLength > 999) {
      return;
    }
    label += source.slice(labelStart, line.next);
    lineIndex++;
    offset = lines[lineIndex].start;
    labelStart = offset;
  }
  label += source.slice(labelStart, offset);
  if (!labelHasContent) {
    return;
  }
  offset += 2;

  const skipSpaces = (): void => {
    while (offset < lines[lineIndex].end && (source[offset] === " " || source[offset] === "\t")) {
      offset++;
    }
  };
  skipSpaces();
  if (offset === lines[lineIndex].end) {
    if (lineIndex + 1 >= lines.length || isBlank(source, lines[lineIndex + 1])) {
      return;
    }
    lineIndex++;
    offset = lines[lineIndex].start;
    skipSpaces();
  }

  let destination: string;
  if (source[offset] === "<") {
    offset++;
    const destinationStart = offset;
    while (offset < lines[lineIndex].end && source[offset] !== ">") {
      if (source[offset] === "<") {
        return;
      }
      if (source[offset] === "\\" && offset + 1 < lines[lineIndex].end) {
        offset += 2;
      }
      else {
        offset++;
      }
    }
    if (source[offset] !== ">") {
      return;
    }
    destination = source.slice(destinationStart, offset);
    offset++;
  }
  else {
    let depth = 0;
    const destinationStart = offset;
    while (offset < lines[lineIndex].end && source[offset] !== " " && source[offset] !== "\t") {
      if (source[offset] === "\\" && offset + 1 < lines[lineIndex].end) {
        offset += 2;
        continue;
      }
      if (source[offset] === "(") {
        if (++depth > 32) {
          return;
        }
      }
      else if (source[offset] === ")" && --depth < 0) {
        return;
      }
      offset++;
    }
    if (offset === destinationStart || depth !== 0) {
      return;
    }
    destination = source.slice(destinationStart, offset);
  }

  const destinationLine = lineIndex;
  if (offset < lines[lineIndex].end && source[offset] !== " " && source[offset] !== "\t") {
    return;
  }
  skipSpaces();
  let titleOnNextLine = false;
  if (offset === lines[lineIndex].end && lineIndex + 1 < lines.length) {
    lineIndex++;
    offset = lines[lineIndex].start;
    skipSpaces();
    titleOnNextLine = true;
  }

  const closer = source[offset] === "("
    ? ")"
    : source[offset] === "\"" || source[offset] === "'"
      ? source[offset]
      : void 0;
  const fields: LinkDefinitionFields = {
    definitionKey: normalizeAssociationLabel(label),
    destination,
    label,
    markerOffset: contentOffset - lines[startIndex].start,
    title: void 0,
  };
  if (!closer) {
    return { end: destinationLine + 1, fields };
  }
  offset++;
  let title = "";
  let titleStart = offset;
  let closed = false;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    while (offset < line.end) {
      if (source[offset] === "\\" && offset + 1 < line.end) {
        offset += 2;
        continue;
      }
      if (source[offset] === closer) {
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
    if (lineIndex + 1 >= lines.length || isBlank(source, lines[lineIndex + 1])) {
      break;
    }
    title += source.slice(titleStart, line.next);
    lineIndex++;
    offset = lines[lineIndex].start;
    titleStart = offset;
  }
  if (!closed) {
    return titleOnNextLine ? { end: destinationLine + 1, fields } : void 0;
  }
  skipSpaces();
  if (offset !== lines[lineIndex].end) {
    return titleOnNextLine ? { end: destinationLine + 1, fields } : void 0;
  }
  fields.title = title;
  return { end: lineIndex + 1, fields };
}

interface ReferenceCloser {
  end: number;
  kind: InlineKind;
}

function referenceLabelEnd(source: string, start: number): number {
  if (source.charCodeAt(start) !== Character.LeftSquareBracket) {
    return -1;
  }
  let offset = start + 1;
  if (source.charCodeAt(offset) === Character.RightSquareBracket) {
    return offset + 1;
  }
  let characters = 0;
  let hasContent = false;
  while (offset < source.length && characters < 999) {
    const code = source.charCodeAt(offset);
    if (code === Character.RightSquareBracket) {
      return hasContent ? offset + 1 : -1;
    }
    if (code === Character.LeftSquareBracket) {
      return -1;
    }
    if (code === Character.ReverseSolidus) {
      if (offset + 1 >= source.length) {
        return -1;
      }
      hasContent = true;
      offset += 2;
    }
    else {
      hasContent ||= (
        code !== Character.CharacterTabulation &&
        code !== Character.LineFeed &&
        code !== Character.CarriageReturn &&
        code !== Character.Space
      );
      offset++;
    }
    characters++;
  }
  return -1;
}

function acceptsShortcutLabel(source: string, start: number, end: number): boolean {
  let hasContent = false;
  let characters = 0;
  for (let offset = start; offset < end; offset++) {
    const code = source.charCodeAt(offset);
    hasContent ||= (
      code !== Character.CharacterTabulation &&
      code !== Character.LineFeed &&
      code !== Character.CarriageReturn &&
      code !== Character.Space
    );
    if (
      code >= Character.HighSurrogateStart &&
      code <= Character.HighSurrogateEnd &&
      offset + 1 < end
    ) {
      const trailing = source.charCodeAt(offset + 1);
      if (trailing >= Character.LowSurrogateStart && trailing <= Character.LowSurrogateEnd) {
        offset++;
      }
    }
    if (++characters > 999) {
      return false;
    }
  }
  return hasContent;
}

function resolveReferenceTokens(
  source: string,
  tokens: InlineTokenStream,
  context: InlineResolutionContext,
): InlineTokenStream {
  const bracketOpeners: number[] = [];
  const imageOpeners: number[] = [];
  const openKinds: number[] = [];
  const closers: (ReferenceCloser | undefined)[] = [];
  let inactiveBefore = 0;
  let lastNestedOpener = 0;
  let changed = false;

  const count = inlineTokenCount(tokens);
  for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
    const kind = inlineTokenKind(tokens, tokenIndex);
    if (kind === InlineKind.BracketOpen) {
      bracketOpeners.push(tokenIndex);
      lastNestedOpener = tokenIndex + 1;
      continue;
    }
    if (kind === InlineKind.ImageOpen) {
      imageOpeners.push(tokenIndex);
      lastNestedOpener = tokenIndex + 1;
      continue;
    }
    if (kind !== InlineKind.LinkTail && kind !== InlineKind.BracketClose) {
      continue;
    }

    const bracketOpener = bracketOpeners[bracketOpeners.length - 1] ?? -1;
    const imageOpener = imageOpeners[imageOpeners.length - 1] ?? -1;
    if (bracketOpener < 0 && imageOpener < 0) {
      continue;
    }
    const image = imageOpener > bracketOpener;
    const openerIndex = image ? imageOpener : bracketOpener;
    if (image) {
      imageOpeners.pop();
    }
    else {
      bracketOpeners.pop();
      if (openerIndex + 1 < inactiveBefore) {
        continue;
      }
    }

    const contentStart = inlineTokenEnd(tokens, openerIndex);
    const contentEnd = inlineTokenStart(tokens, tokenIndex);
    let closeEnd = inlineTokenEnd(tokens, tokenIndex);
    let reference = false;

    if (kind === InlineKind.BracketClose) {
      const labelEnd = referenceLabelEnd(source, closeEnd);
      if (labelEnd > 0) {
        const explicit = source.slice(closeEnd + 1, labelEnd - 1);
        const label = explicit || source.slice(contentStart, contentEnd);
        if (!context.hasDefinition(normalizeAssociationLabel(label))) {
          continue;
        }
        closeEnd = labelEnd;
        reference = true;
      }
      else {
        if (
          lastNestedOpener > openerIndex + 1 ||
          !acceptsShortcutLabel(source, contentStart, contentEnd) ||
          !context.hasDefinition(normalizeAssociationLabel(source.slice(contentStart, contentEnd)))
        ) {
          continue;
        }
        reference = true;
      }
    }

    openKinds[openerIndex] = image
      ? reference ? InlineKind.ImageReferenceOpen : InlineKind.ImageLinkOpen
      : reference ? InlineKind.ReferenceOpen : InlineKind.LinkOpen;
    closers[tokenIndex] = {
      end: closeEnd,
      kind: image
        ? reference ? InlineKind.ImageReferenceClose : InlineKind.ImageLinkClose
        : reference ? InlineKind.ReferenceClose : InlineKind.LinkClose,
    };
    changed = true;
    if (!image) {
      inactiveBefore = Math.max(inactiveBefore, openerIndex + 1);
    }
    while (
      tokenIndex + 1 < count &&
      inlineTokenStart(tokens, tokenIndex + 1) < closeEnd
    ) {
      tokenIndex++;
    }
  }

  if (!changed) {
    return tokens;
  }
  const result: number[] = [];
  for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
    const closer = closers[tokenIndex];
    const kind = openKinds[tokenIndex];
    if (closer) {
      appendInlineToken(
        result,
        closer.kind,
        inlineTokenStart(tokens, tokenIndex),
        closer.end,
        inlineTokenFlags(tokens, tokenIndex),
      );
      while (
        tokenIndex + 1 < count &&
        inlineTokenStart(tokens, tokenIndex + 1) < closer.end
      ) {
        tokenIndex++;
      }
    }
    else if (kind !== void 0) {
      appendInlineToken(
        result,
        kind,
        inlineTokenStart(tokens, tokenIndex),
        inlineTokenEnd(tokens, tokenIndex),
        inlineTokenFlags(tokens, tokenIndex),
      );
    }
    else {
      copyInlineToken(result, tokens, tokenIndex);
    }
  }
  return result;
}

export const feature: SyntaxFeature = {
  block: {
    restart(source, lines, changedStart, changedEnd) {
      const end = firstLineIndexAtOrAfter(lines, Math.max(1, changedEnd));
      let candidate: number | undefined;
      for (let index = end - 1; index >= 0; index--) {
        const line = lines[index];
        if (isBlank(source, line)) {
          break;
        }
        const indent = indentOf(source, line, 3);
        if (source[indent.offset] === "[") {
          candidate = line.start;
        }
      }
      return candidate;
    },
    rules: [
      {
        rule: BlockRule.LinkDefinition,
        syntax: {
          kind: "block",
          open: BlockKind.LinkDefinitionOpen,
          close: BlockKind.LinkDefinitionClose,
        },
        build(tokenStart, context) {
          const fields = linkDefinitionFields(context.structure.tokens, tokenStart);
          return {
            type: "definition",
            identifier: fields.definitionKey.toLowerCase(),
            label: semanticText(fields.label),
            url: semanticText(fields.destination),
            title: fields.title === void 0 ? null : semanticText(fields.title),
            position: {
              start: context.structure.tokens.start(tokenStart) + fields.markerOffset,
              end: blockEnd(tokenStart, context),
            },
          };
        },
        definitionKey(tokens, token) {
          return linkDefinitionFields(tokens, token).definitionKey;
        },
      },
    ],
    starts: [
      {
        codes: [
          Character.LeftSquareBracket,
        ],
        start(source, lines, start, out, contentOffset) {
          const definition = linkDefinitionAt(source, lines, start, contentOffset);
          if (!definition) {
            return;
          }
          const line = lines[start];
          out.push(BlockKind.LinkDefinitionOpen, line.start, line.start, { value: definition.fields });
          for (let definitionLine = start; definitionLine < definition.end; definitionLine++) {
            const current = lines[definitionLine];
            const end = definitionLine + 1 < definition.end ? current.next : current.end;
            out.push(BlockKind.LinkDefinitionChunk, current.start, end);
          }
          const end = lines[definition.end - 1].end;
          out.push(BlockKind.LinkDefinitionClose, end, end);
          return definition.end;
        },
      },
    ],
  },
  inline: {
    resolve: {
      transform: resolveReferenceTokens,
    },
  },
};
