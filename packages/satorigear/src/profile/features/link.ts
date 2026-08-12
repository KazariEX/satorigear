import type { PhrasingContent } from "mdast";
import {
  appendInline,
  type InlineAccumulator,
  type InlineNodeBuilder,
} from "../../fragment/inline.ts";
import { InlineKind } from "../../inline/kinds.ts";
import { inlineTokenEnd, inlineTokenStart, inlineTokenText } from "../../inline/tokens.ts";
import { normalizeAssociationLabel } from "../utils.ts";
import { buildInlineText, semanticText } from "./text.ts";
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

function trimLinkWhitespace(value: string): string {
  return value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

function destinationTitle(bodySource: string): Resource {
  const body = trimLinkWhitespace(bodySource);
  if (!body) {
    return { url: "", title: null };
  }
  let offset = 0;
  let destination = "";
  if (body[0] === "<") {
    offset = 1;
    while (offset < body.length) {
      if (body[offset] === "\\") {
        offset += 2;
      }
      else if (body[offset] === ">") {
        break;
      }
      else {
        offset++;
      }
    }
    destination = body.slice(1, offset++);
  }
  else {
    let depth = 0;
    while (offset < body.length) {
      if (body[offset] === "\\") {
        offset += 2;
      }
      else if (body[offset] === "(") {
        depth++;
        offset++;
      }
      else if (body[offset] === ")") {
        depth--;
        offset++;
      }
      else if (/[ \t\r\n]/.test(body[offset]) && depth === 0) {
        break;
      }
      else {
        offset++;
      }
    }
    destination = body.slice(0, offset);
  }
  const titleSource = trimLinkWhitespace(body.slice(offset));
  return {
    url: semanticText(destination),
    title: titleSource ? semanticText(titleSource.slice(1, -1)) : null,
  };
}

function reference(
  close: number,
  syntaxStart: number,
  syntaxEnd: number,
  context: InlineAccumulator["context"],
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

  return (openToken, closeToken, children, sourceSpan, accumulator) => {
    const context = accumulator.context;
    if (referenceNode) {
      const association = reference(
        closeToken,
        inlineTokenStart(context.tokens, openToken),
        inlineTokenEnd(context.tokens, closeToken),
        context,
        image,
      );
      appendInline(
        accumulator,
        image
          ? { type: "imageReference", alt: phrasingText(children), ...association, position: sourceSpan }
          : { type: "linkReference", children, ...association, position: sourceSpan },
      );
    }
    else {
      const resource = destinationTitle(
        inlineTokenText(context.view.text, context.tokens, closeToken).slice(2, -1),
      );
      appendInline(
        accumulator,
        image
          ? { type: "image", alt: phrasingText(children), ...resource, position: sourceSpan }
          : { type: "link", children, ...resource, position: sourceSpan },
      );
    }
  };
}

const buildInlineImage = createBuildMedia("image", "direct");
const buildInlineReferenceImage = createBuildMedia("image", "reference");
const buildInlineLink = createBuildMedia("link", "direct");
const buildInlineReferenceLink = createBuildMedia("link", "reference");

export const feature: SyntaxFeature = {
  inline: {
    syntax: [
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
        build(tokenIndex, sourceSpan, accumulator) {
          const { context } = accumulator;
          const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
          const label = text.slice(1, -1);
          appendInline(accumulator, {
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
          });
          return true;
        },
      },
      { kind: "leaf", token: InlineKind.BracketOpen, build: buildInlineText },
      { kind: "leaf", token: InlineKind.ImageOpen, build: buildInlineText },
      { kind: "leaf", token: InlineKind.LinkTail, build: buildInlineText },
      { kind: "leaf", token: InlineKind.ReferenceTail, build: buildInlineText },
      { kind: "leaf", token: InlineKind.ShortcutReferenceTail, build: buildInlineText },
      { kind: "leaf", token: InlineKind.ReferenceSeparatorClose, build: buildInlineText },
    ],
  },
};
