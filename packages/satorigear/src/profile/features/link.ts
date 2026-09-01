import type { PhrasingContent } from "mdast";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import {
  appendInlineToken,
  inlineTokenData,
  inlineTokenEnd,
  inlineTokenStart,
  type InlineTokenStream,
  inlineTokenText,
} from "../../inline/tokens.ts";
import { isMarkdownWhitespace, normalizeAssociationLabel, semanticText } from "../utils.ts";
import { buildDecodedInlineText, buildInlineText } from "./text.ts";
import type { InlineBuildContext, InlineNodeBuilder } from "../../fragment/inline.ts";
import type { SyntaxFeature } from "../types.ts";

interface Reference {
  identifier: string;
  label: string;
  referenceType: "collapsed" | "full" | "shortcut";
}

interface Resource {
  title: string | null;
  url: string;
}

function skipWhitespace(source: string, start: number): number {
  let end = start;
  while (end < source.length) {
    const code = source.charCodeAt(end);
    if (!isMarkdownWhitespace(code)) {
      break;
    }
    end++;
  }
  return end;
}

function linkDestinationEnd(source: string, start: number): number {
  if (source.charCodeAt(start) === Character.LessThanSign) {
    let end = start + 1;
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
  let end = start;
  let consumed = false;
  while (end < source.length) {
    const code = source.charCodeAt(end);
    if (code === Character.ReverseSolidus) {
      if (end + 1 >= source.length) {
        break;
      }
      consumed = true;
      end += 2;
      continue;
    }
    if (code === Character.LeftParenthesis) {
      if (depth === 32) {
        return -1;
      }
      depth++;
      consumed = true;
      end++;
      continue;
    }
    if (code === Character.RightParenthesis) {
      if (depth === 0) {
        break;
      }
      depth--;
      consumed = true;
      end++;
      continue;
    }
    if (isMarkdownWhitespace(code)) {
      break;
    }
    consumed = true;
    end++;
  }
  return consumed && depth === 0 ? end : -1;
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

const simpleLinkTail = /\([^<\\()\t\n\r ]+\)/y;

function scanLinkTail(source: string, start: number, tokens: number[]): number {
  simpleLinkTail.lastIndex = start + 1;
  // Fast path for simple inline link tails such as `](destination)`.
  if (simpleLinkTail.test(source)) {
    const end = simpleLinkTail.lastIndex;
    appendInlineToken(tokens, InlineKind.LinkTail, start, end, end - start - 1);
    return end;
  }
  if (source.charCodeAt(start + 1) !== Character.LeftParenthesis) {
    return -1;
  }
  let offset = skipWhitespace(source, start + 2);
  let destinationEnd = offset;
  if (source.charCodeAt(offset) !== Character.RightParenthesis) {
    destinationEnd = linkDestinationEnd(source, offset);
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
  appendInlineToken(
    tokens,
    InlineKind.LinkTail,
    start,
    end,
    destinationEnd - start,
  );
  return end;
}

// LinkTail is already validated by the lexer; projection only separates its output fields.
function resourceAt(source: string, tokens: InlineTokenStream, tokenIndex: number): Resource {
  const tokenStart = inlineTokenStart(tokens, tokenIndex);
  const tokenEnd = inlineTokenEnd(tokens, tokenIndex);
  let start = tokenStart + 2;
  let end = tokenEnd - 1;
  while (start < end && isMarkdownWhitespace(source.charCodeAt(start))) {
    start++;
  }
  while (end > start && isMarkdownWhitespace(source.charCodeAt(end - 1))) {
    end--;
  }
  if (start === end) {
    return { url: "", title: null };
  }

  const resourceEnd = tokenStart + inlineTokenData(tokens, tokenIndex);
  let destinationStart = start;
  let destinationEnd = resourceEnd;
  if (source[start] === "<") {
    destinationStart++;
    destinationEnd--;
  }
  start = resourceEnd;

  while (start < end && isMarkdownWhitespace(source.charCodeAt(start))) {
    start++;
  }
  return {
    url: semanticText(source.slice(destinationStart, destinationEnd)),
    title: start < end ? semanticText(source.slice(start + 1, end - 1)) : null,
  };
}

function reference(
  close: number,
  syntaxStart: number,
  syntaxEnd: number,
  context: InlineBuildContext,
  image: boolean,
): Reference {
  const closeText = inlineTokenText(context.view.text, context.tokens, close);
  const text = context.view.text.slice(syntaxStart, syntaxEnd);
  const content = text.slice(image ? 2 : 1, text.length - closeText.length);
  const full = closeText.startsWith("][") && closeText !== "][]";
  const labelSource = full ? closeText.slice(2, -1) : content;
  return {
    identifier: normalizeAssociationLabel(labelSource),
    label: semanticText(labelSource),
    referenceType: full ? "full" : closeText === "][]" ? "collapsed" : "shortcut",
  };
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

function createBuildMedia(media: "image" | "link", resourceKind: "direct" | "reference"): InlineNodeBuilder {
  const image = media === "image";
  const referenceNode = resourceKind === "reference";

  return (openToken, closeToken, sourceSpan, children, context) => {
    if (referenceNode) {
      const association = reference(
        closeToken,
        inlineTokenStart(context.tokens, openToken),
        inlineTokenEnd(context.tokens, closeToken),
        context,
        image,
      );
      return image
        ? {
          type: "imageReference",
          alt: phrasingText(children),
          ...association,
          position: sourceSpan,
        }
        : {
          type: "linkReference",
          children,
          ...association,
          position: sourceSpan,
        };
    }
    const resource = resourceAt(context.view.text, context.tokens, closeToken);
    return image
      ? {
        type: "image",
        alt: phrasingText(children),
        ...resource,
        position: sourceSpan,
      }
      : {
        type: "link",
        children,
        ...resource,
        position: sourceSpan,
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
        build(tokenIndex, sourceSpan, context) {
          const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
          const label = text.slice(1, -1);
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
                    line: sourceSpan.start.line,
                    column: sourceSpan.start.column + 1,
                    offset: sourceSpan.start.offset + 1,
                  },
                  end: {
                    line: sourceSpan.end.line,
                    column: sourceSpan.end.column - 1,
                    offset: sourceSpan.end.offset - 1,
                  },
                },
              },
            ],
            position: sourceSpan,
          };
        },
      },
      { kind: "text", token: InlineKind.BracketOpen, build: buildInlineText },
      { kind: "text", token: InlineKind.ImageOpen, build: buildInlineText },
      { kind: "text", token: InlineKind.LinkTail, build: buildDecodedInlineText },
      { kind: "text", token: InlineKind.BracketClose, build: buildInlineText },
    ],
  },
};
