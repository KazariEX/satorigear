import type { PhrasingContent } from "mdast";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import {
  appendInlineToken,
  inlineTokenData,
  inlineTokenEnd,
  inlineTokenStart,
  inlineTokenText,
} from "../../inline/tokens.ts";
import { isSpaceTabOrLineEnding, normalizeIdentifier, semanticText } from "../utils.ts";
import { buildDecodedInlineText } from "./text.ts";
import type { InlinePairBuilder } from "../../fragment/inline.ts";
import type { SyntaxFeature } from "../types.ts";

function skipWhitespace(source: string, start: number, end = source.length): number {
  while (start < end) {
    const code = source.charCodeAt(start);
    if (!isSpaceTabOrLineEnding(code)) {
      break;
    }
    start++;
  }
  return start;
}

function linkDestinationEnd(source: string, start: number, end: number): number {
  if (source.charCodeAt(start) === Character.LessThanSign) {
    end = start + 1;
    while (end < source.length) {
      const code = source.charCodeAt(end);
      if (code === Character.GreaterThanSign) {
        return end + 1;
      }
      if (
        code === Character.LineFeed ||
        code === Character.CarriageReturn ||
        code === Character.LessThanSign
      ) {
        return -1;
      }
      end += code === Character.ReverseSolidus && end + 1 < source.length ? 2 : 1;
    }
    return -1;
  }

  let depth = 0;
  while (end < source.length) {
    const code = source.charCodeAt(end);
    if (code === Character.ReverseSolidus) {
      if (end + 1 >= source.length) {
        break;
      }
      end++;
    }
    else if (code === Character.LeftParenthesis) {
      if (depth === 32) {
        return -1;
      }
      depth++;
    }
    else if (code === Character.RightParenthesis) {
      if (depth === 0) {
        break;
      }
      depth--;
    }
    else if (isSpaceTabOrLineEnding(code)) {
      break;
    }
    end++;
  }
  return end > start && depth === 0 ? end : -1;
}

function linkTitleEnd(source: string, start: number): number {
  const marker = source.charCodeAt(start);
  const close = marker === Character.LeftParenthesis ? Character.RightParenthesis : marker;
  if (
    marker !== Character.QuotationMark &&
    marker !== Character.Apostrophe &&
    marker !== Character.LeftParenthesis
  ) {
    return -1;
  }
  let end = start + 1;
  while (end < source.length) {
    const code = source.charCodeAt(end);
    if (code === close) {
      return end + 1;
    }
    if (code === Character.LineFeed || code === Character.CarriageReturn) {
      return -1;
    }
    end += code === Character.ReverseSolidus && end + 1 < source.length ? 2 : 1;
  }
  return -1;
}

const destinationTail = /[^<\\()\t\n\r ]*\)?/y;

function scanLinkTail(source: string, start: number, tokens: number[]): number {
  if (source.charCodeAt(start + 1) !== Character.LeftParenthesis) {
    return -1;
  }
  const contentStart = start + 2;
  // An ordinary destination consumes its closing parenthesis in the same match.
  destinationTail.lastIndex = contentStart;
  destinationTail.test(source);
  const prefixEnd = destinationTail.lastIndex;
  if (source.charCodeAt(prefixEnd - 1) === Character.RightParenthesis) {
    appendInlineToken(tokens, InlineKind.LinkTail, start, prefixEnd);
    return prefixEnd;
  }
  let offset = skipWhitespace(source, contentStart);
  let destinationEnd = offset;
  if (source.charCodeAt(offset) !== Character.RightParenthesis) {
    destinationEnd = linkDestinationEnd(source, offset, Math.max(offset, prefixEnd));
    if (destinationEnd < 0) {
      return -1;
    }
    offset = destinationEnd;
    const whitespaceEnd = skipWhitespace(source, offset);
    if (whitespaceEnd > offset && source.charCodeAt(whitespaceEnd) !== Character.RightParenthesis) {
      const titleEnd = linkTitleEnd(source, whitespaceEnd);
      if (titleEnd < 0) {
        return -1;
      }
      offset = skipWhitespace(source, titleEnd);
    }
    else {
      offset = whitespaceEnd;
    }
    if (source.charCodeAt(offset) !== Character.RightParenthesis) {
      return -1;
    }
  }
  const end = offset + 1;
  appendInlineToken(tokens, InlineKind.LinkTail, start, end, destinationEnd - start);
  return end;
}

function phrasingText(children: readonly PhrasingContent[]): string {
  let result = "";
  for (const child of children) {
    if (child.type === "text" || child.type === "inlineCode" || child.type === "html") {
      result += child.value;
    }
    else if (child.type === "break") {
      result += "\n";
    }
    else if ("children" in child) {
      result += phrasingText(child.children);
    }
    else if (child.type === "image" || child.type === "imageReference") {
      result += child.alt ?? "";
    }
  }
  return result;
}

function createBuildMedia(media: "image" | "link", resourceKind: "direct" | "reference"): InlinePairBuilder {
  const isImage = media === "image";
  const isReference = resourceKind === "reference";

  return isReference
    ? (openToken, closeToken, position, children, context) => {
      const closeText = inlineTokenText(context.view.text, context.tokens, closeToken);
      const syntaxStart = inlineTokenStart(context.tokens, openToken);
      const syntaxEnd = inlineTokenEnd(context.tokens, closeToken);
      const full = closeText.startsWith("][") && closeText !== "][]";
      const labelSource = full
        ? closeText.slice(2, -1)
        : context.view.text.slice(syntaxStart + (isImage ? 2 : 1), syntaxEnd - closeText.length);
      const identifier = normalizeIdentifier(labelSource);
      const label = semanticText(labelSource);
      const referenceType = full ? "full" : closeText === "][]" ? "collapsed" : "shortcut";
      return isImage
        ? {
          type: "imageReference",
          alt: phrasingText(children),
          identifier,
          label,
          referenceType,
          position,
        }
        : {
          type: "linkReference",
          children,
          identifier,
          label,
          referenceType,
          position,
        };
    }
    : (openToken, closeToken, position, children, context) => {
      const source = context.view.text;
      const tokenStart = inlineTokenStart(context.tokens, closeToken);
      const end = inlineTokenEnd(context.tokens, closeToken) - 1;
      let start = tokenStart + 2;
      let destinationEnd = end;
      let title: string | null = null;

      // Only the general form records a separate end for its destination.
      const endInTail = inlineTokenData(context.tokens, closeToken);
      if (endInTail) {
        const resourceEnd = tokenStart + endInTail;
        start = skipWhitespace(source, start, resourceEnd);
        destinationEnd = resourceEnd;
        if (source.charCodeAt(start) === Character.LessThanSign) {
          start++;
          destinationEnd--;
        }
        const titleStart = skipWhitespace(source, resourceEnd, end);
        if (titleStart < end) {
          let titleEnd = end;
          while (isSpaceTabOrLineEnding(source.charCodeAt(titleEnd - 1))) {
            titleEnd--;
          }
          title = semanticText(source.slice(titleStart + 1, titleEnd - 1));
        }
      }
      const url = semanticText(source.slice(start, destinationEnd));

      return isImage
        ? {
          type: "image",
          alt: phrasingText(children),
          url,
          title,
          position,
        }
        : {
          type: "link",
          children,
          url,
          title,
          position,
        };
    };
}

const buildInlineImage = createBuildMedia("image", "direct");
const buildInlineReferenceImage = createBuildMedia("image", "reference");
const buildInlineLink = createBuildMedia("link", "direct");
const buildInlineReferenceLink = createBuildMedia("link", "reference");

export const feature: SyntaxFeature = {
  inline: {
    scans: [
      {
        marker: Character.ExclamationMark,
        scan(source, start, tokens) {
          if (source.charCodeAt(start + 1) !== Character.LeftSquareBracket) {
            return start + 1;
          }
          const end = start + 2;
          appendInlineToken(tokens, InlineKind.ImageOpen, start, end);
          return end;
        },
      },
      {
        marker: Character.LeftSquareBracket,
        scan(source, start, tokens) {
          const end = start + 1;
          appendInlineToken(tokens, InlineKind.BracketOpen, start, end);
          return end;
        },
      },
      {
        marker: Character.RightSquareBracket,
        scan(source, start, tokens) {
          const end = scanLinkTail(source, start, tokens);
          if (end >= 0) {
            return end;
          }
          appendInlineToken(tokens, InlineKind.BracketClose, start, start + 1);
          return start + 1;
        },
      },
    ],
    builds: [
      {
        kind: "pair",
        token: InlineKind.LinkOpen,
        build: buildInlineLink,
      },
      {
        kind: "pair",
        token: InlineKind.ImageLinkOpen,
        build: buildInlineImage,
      },
      {
        kind: "pair",
        token: InlineKind.ReferenceOpen,
        build: buildInlineReferenceLink,
      },
      {
        kind: "pair",
        token: InlineKind.ImageReferenceOpen,
        build: buildInlineReferenceImage,
      },
      {
        kind: "leaf",
        token: InlineKind.Autolink,
        build(tokenIndex, position, context) {
          const label = inlineTokenText(context.view.text, context.tokens, tokenIndex, 1);
          return {
            type: "link",
            url: label.includes(":") ? label : `mailto:${label}`,
            title: null,
            children: [
              {
                type: "text",
                value: label,
                position: {
                  start: {
                    line: position.start.line,
                    column: position.start.column + 1,
                    offset: position.start.offset + 1,
                  },
                  end: {
                    line: position.end.line,
                    column: position.end.column - 1,
                    offset: position.end.offset - 1,
                  },
                },
              },
            ],
            position,
          };
        },
      },
      { kind: "text", token: InlineKind.LinkTail, build: buildDecodedInlineText },
    ],
  },
};
