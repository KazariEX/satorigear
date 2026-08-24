import { type BlockLine, isBlank } from "../../block/lines.ts";
import { BlockKind, BlockRule } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { blockEnd } from "../../fragment/block.ts";
import {
  appendInlineToken,
  copyInlineToken,
  inlineTokenCount,
  inlineTokenData,
  inlineTokenEnd,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
} from "../../inline/tokens.ts";
import { normalizeAssociationLabel } from "../utils.ts";
import { semanticText } from "./text.ts";
import type { BlockScanContext } from "../../block/scanner.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
import type { InlineResolutionContext } from "../../inline/profile.ts";
import type { SyntaxFeature } from "../types.ts";

interface LinkDefinitionFields {
  definitionKey: string;
  destination: string;
  label: string;
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
  context: BlockScanContext,
): LinkDefinitionMatch | undefined {
  let lineIndex = startIndex;
  let lookaheadEnd = -1;
  let offset = contentOffset + 1;
  let label = "";
  let labelLength = 0;
  let labelHasContent = false;
  let labelStart = offset;

  // Funnel failures through one exit so only unrepresented lookahead becomes scanner state.
  parseDefinition: {
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
          break parseDefinition;
        }
        if (code === Character.RightSquareBracket) {
          if (source.charCodeAt(offset + 1) === Character.Colon) {
            break scanLabel;
          }
          // Link labels cannot contain an unescaped "]",
          // so a "]" that does not introduce the colon never yields a definition.
          break parseDefinition;
        }
        if (code !== Character.Space && code !== Character.CharacterTabulation) {
          labelHasContent = true;
        }
        if (++labelLength > 999) {
          break parseDefinition;
        }
        offset++;
      }
      const nextLine = lines[lineIndex + 1];
      lookaheadEnd = nextLine?.end ?? line.next;
      if (!nextLine || isBlank(source, nextLine)) {
        break parseDefinition;
      }
      if (++labelLength > 999) {
        break parseDefinition;
      }
      label += source.slice(labelStart, line.next);
      lineIndex++;
      offset = lines[lineIndex].start;
      labelStart = offset;
    }
    label += source.slice(labelStart, offset);
    if (!labelHasContent) {
      break parseDefinition;
    }
    offset += 2;

    const skipSpaces = (): void => {
      while (offset < lines[lineIndex].end && (source[offset] === " " || source[offset] === "\t")) {
        offset++;
      }
    };
    skipSpaces();
    if (offset === lines[lineIndex].end) {
      const nextLine = lines[lineIndex + 1];
      lookaheadEnd = nextLine?.end ?? lines[lineIndex].next;
      if (!nextLine || isBlank(source, nextLine)) {
        break parseDefinition;
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
          break parseDefinition;
        }
        if (source[offset] === "\\" && offset + 1 < lines[lineIndex].end) {
          offset += 2;
        }
        else {
          offset++;
        }
      }
      if (source[offset] !== ">") {
        break parseDefinition;
      }
      destination = source.slice(destinationStart, offset);
      offset++;
    }
    else {
      let depth = 0;
      const destinationStart = offset;
      while (offset < lines[lineIndex].end) {
        const code = source.charCodeAt(offset);
        if (code === Character.Space || code === Character.CharacterTabulation) {
          break;
        }
        if (code === Character.ReverseSolidus && offset + 1 < lines[lineIndex].end) {
          offset += 2;
          continue;
        }
        if (code === Character.LeftParenthesis) {
          if (++depth > 32) {
            break parseDefinition;
          }
        }
        else if (code === Character.RightParenthesis && --depth < 0) {
          break parseDefinition;
        }
        offset++;
      }
      if (offset === destinationStart || depth !== 0) {
        break parseDefinition;
      }
      destination = source.slice(destinationStart, offset);
    }

    const destinationLine = lineIndex;
    if (offset < lines[lineIndex].end && source[offset] !== " " && source[offset] !== "\t") {
      break parseDefinition;
    }
    skipSpaces();
    let titleOnNextLine = false;
    if (offset === lines[lineIndex].end && lineIndex + 1 < lines.length) {
      lookaheadEnd = lines[lineIndex + 1].end;
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
      const nextLine = lines[lineIndex + 1];
      lookaheadEnd = nextLine?.end ?? line.next;
      if (!nextLine || isBlank(source, nextLine)) {
        break;
      }
      title += source.slice(titleStart, line.next);
      lineIndex++;
      offset = lines[lineIndex].start;
      titleStart = offset;
    }
    if (closed) {
      skipSpaces();
      if (offset === lines[lineIndex].end) {
        fields.title = title;
        return { end: lineIndex + 1, fields };
      }
    }
    if (!titleOnNextLine) {
      break parseDefinition;
    }
    if (lookaheadEnd > lines[destinationLine + 1].next) {
      context.retainLookahead(lookaheadEnd);
    }
    return { end: destinationLine + 1, fields };
  }
  if (lookaheadEnd >= 0) {
    context.retainLookahead(lookaheadEnd);
  }
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

function transformReferenceTokens(
  source: string,
  tokens: InlineTokenStream,
  context: InlineResolutionContext,
): InlineTokenStream {
  let closerEnds: number[] | undefined;
  let inactiveBefore = 0;
  let lastNestedOpener = 0;
  // One source-order stack is sufficient; complemented indexes distinguish image openers without records.
  let openers: number[] | undefined;
  let replacementKinds: number[] | undefined;

  const count = inlineTokenCount(tokens);
  for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
    const kind = inlineTokenKind(tokens, tokenIndex);
    if (kind === InlineKind.BracketOpen) {
      (openers ??= []).push(tokenIndex);
      lastNestedOpener = tokenIndex + 1;
      continue;
    }
    if (kind === InlineKind.ImageOpen) {
      (openers ??= []).push(~tokenIndex);
      lastNestedOpener = tokenIndex + 1;
      continue;
    }
    if (kind !== InlineKind.LinkTail && kind !== InlineKind.BracketClose) {
      continue;
    }

    const encodedOpener = openers?.pop();
    if (encodedOpener === void 0) {
      continue;
    }
    const image = encodedOpener < 0;
    const openerIndex = image ? ~encodedOpener : encodedOpener;
    if (!image && openerIndex + 1 < inactiveBefore) {
      continue;
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

    replacementKinds ??= [];
    replacementKinds[openerIndex] = image
      ? reference ? InlineKind.ImageReferenceOpen : InlineKind.ImageLinkOpen
      : reference ? InlineKind.ReferenceOpen : InlineKind.LinkOpen;
    replacementKinds[tokenIndex] = image
      ? reference ? InlineKind.ImageReferenceClose : InlineKind.ImageLinkClose
      : reference ? InlineKind.ReferenceClose : InlineKind.LinkClose;
    closerEnds ??= [];
    closerEnds[tokenIndex] = closeEnd;

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

  if (!replacementKinds) {
    return tokens;
  }
  const result: number[] = [];
  for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
    const closerEnd = closerEnds?.[tokenIndex];
    const kind = replacementKinds[tokenIndex];
    if (closerEnd !== void 0) {
      appendInlineToken(
        result,
        kind,
        inlineTokenStart(tokens, tokenIndex),
        closerEnd,
        inlineTokenData(tokens, tokenIndex),
      );
      while (
        tokenIndex + 1 < count &&
        inlineTokenStart(tokens, tokenIndex + 1) < closerEnd
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
        inlineTokenData(tokens, tokenIndex),
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
              start: context.structure.tokens.start(tokenStart),
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
        start(source, lines, start, out, contentOffset, context) {
          const definition = linkDefinitionAt(source, lines, start, contentOffset, context);
          if (!definition) {
            return;
          }
          out.push(BlockKind.LinkDefinitionOpen, contentOffset, contentOffset, { value: definition.fields });
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
      transform: transformReferenceTokens,
    },
  },
};
