import type { PhrasingContent } from "mdast";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import {
  appendInlineToken,
  inlineTokenEnd,
  InlineTokenFlag,
  inlineTokenStart,
  inlineTokenText,
} from "../../inline/tokens.ts";
import { normalizeAssociationLabel } from "../utils.ts";
import { buildInlineText, semanticText } from "./text.ts";
import type { InlineBuildContext, InlineNodeBuilder } from "../../fragment/inline.ts";
import type { SpannedNode } from "../../fragment/node.ts";
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
    if (
      code !== Character.CharacterTabulation &&
      code !== Character.LineFeed &&
      code !== Character.CarriageReturn &&
      code !== Character.Space
    ) {
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
    if (isLinkWhitespace(code)) {
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

function linkTailEnd(source: string, start: number): number {
  if (source.charCodeAt(start + 1) !== Character.LeftParenthesis) {
    return -1;
  }
  let offset = skipWhitespace(source, start + 2);
  if (source.charCodeAt(offset) === Character.RightParenthesis) {
    return offset + 1;
  }
  const destinationEnd = linkDestinationEnd(source, offset);
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
    offset = titleEnd;
  }
  else {
    offset = whitespaceEnd;
  }
  offset = skipWhitespace(source, offset);
  return source.charCodeAt(offset) === Character.RightParenthesis ? offset + 1 : -1;
}

function referenceTailEnd(source: string, start: number): number {
  if (source.charCodeAt(start + 1) !== Character.LeftSquareBracket) {
    return -1;
  }
  let offset = start + 2;
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
      hasContent ||= !isLinkWhitespace(code);
      offset++;
    }
    characters++;
  }
  return -1;
}

function isLinkWhitespace(code: number): boolean {
  return (
    code === Character.CharacterTabulation ||
    code === Character.LineFeed ||
    code === Character.CarriageReturn ||
    code === Character.Space
  );
}

// LinkTail is already validated by the lexer; projection only separates its output fields.
function resourceAt(source: string, tokenStart: number, tokenEnd: number): Resource {
  let start = tokenStart + 2;
  let end = tokenEnd - 1;
  while (start < end && isLinkWhitespace(source.charCodeAt(start))) {
    start++;
  }
  while (end > start && isLinkWhitespace(source.charCodeAt(end - 1))) {
    end--;
  }
  if (start === end) {
    return { url: "", title: null };
  }

  let destinationStart = start;
  let destinationEnd = start;
  if (source[start] === "<") {
    destinationStart++;
    destinationEnd = destinationStart;
    while (destinationEnd < end) {
      if (source[destinationEnd] === "\\") {
        destinationEnd += 2;
      }
      else if (source[destinationEnd] === ">") {
        break;
      }
      else {
        destinationEnd++;
      }
    }
    start = destinationEnd + 1;
  }
  else {
    destinationEnd = start;
    while (destinationEnd < end) {
      if (source[destinationEnd] === "\\") {
        destinationEnd += 2;
      }
      else if (isLinkWhitespace(source.charCodeAt(destinationEnd))) {
        break;
      }
      else {
        destinationEnd++;
      }
    }
    start = destinationEnd;
  }

  while (start < end && isLinkWhitespace(source.charCodeAt(start))) {
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
    identifier: normalizeAssociationLabel(labelSource).toLowerCase(),
    label: semanticText(labelSource),
    referenceType: full ? "full" : closeText === "][]" ? "collapsed" : "shortcut",
  };
}

function phrasingText(children: readonly SpannedNode<PhrasingContent>[]): string {
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
    const resource = resourceAt(
      context.view.text,
      inlineTokenStart(context.tokens, closeToken),
      inlineTokenEnd(context.tokens, closeToken),
    );
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
    scan: [
      {
        marker: Character.ExclamationMark,
        scan(source, start, tokens) {
          const image = source.charCodeAt(start + 1) === Character.LeftSquareBracket;
          const end = start + (image ? 2 : 1);
          appendInlineToken(tokens, image ? InlineKind.ImageOpen : InlineKind.Delimiter, start, end);
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
          let end = linkTailEnd(source, start);
          let kind = InlineKind.LinkTail;
          if (end < 0) {
            end = referenceTailEnd(source, start);
            kind = InlineKind.ReferenceTail;
          }
          if (end < 0) {
            end = start + 1;
            kind = InlineKind.BracketClose;
          }
          appendInlineToken(
            tokens,
            kind,
            start,
            end,
            kind === InlineKind.BracketClose ? 0 : InlineTokenFlag.DecodeText,
          );
          return end;
        },
      },
    ],
    build: [
      {
        kind: "pair",
        open: InlineKind.LinkOpen,
        close: InlineKind.LinkClose,
        build: buildInlineLink,
      },
      {
        kind: "pair",
        open: InlineKind.ImageLinkOpen,
        close: InlineKind.ImageLinkClose,
        build: buildInlineImage,
      },
      {
        kind: "pair",
        open: InlineKind.ReferenceOpen,
        close: InlineKind.ReferenceClose,
        build: buildInlineReferenceLink,
      },
      {
        kind: "pair",
        open: InlineKind.ImageReferenceOpen,
        close: InlineKind.ImageReferenceClose,
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
                position: { start: sourceSpan.start + 1, end: sourceSpan.end - 1 },
              },
            ],
            position: sourceSpan,
          };
        },
      },
      { kind: "leaf", token: InlineKind.BracketOpen, build: buildInlineText },
      { kind: "leaf", token: InlineKind.ImageOpen, build: buildInlineText },
      { kind: "leaf", token: InlineKind.LinkTail, build: buildInlineText },
      { kind: "leaf", token: InlineKind.ReferenceTail, build: buildInlineText },
      { kind: "leaf", token: InlineKind.BracketClose, build: buildInlineText },
      { kind: "leaf", token: InlineKind.ReferenceSeparatorClose, build: buildInlineText },
    ],
  },
};
