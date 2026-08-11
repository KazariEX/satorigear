import type { Image, ImageReference, Link, LinkReference, PhrasingContent, Text } from "mdast";
import { inlineTokenText } from "../../inline/tokens.ts";
import {
  appendInline,
  buildInlineChildren,
  contentBounds,
  createInlineAccumulator,
  type InlineAccumulator,
  type InlineNodeBuilder,
  inlineSequence,
  leaf,
  type SpannedNode,
  withSpan,
} from "../../mdast.ts";
import { normalizeAssociationLabel } from "../utils.ts";
import { buildInlineText, semanticText } from "./text.ts";
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
  nodeId: number,
  syntaxStart: number,
  syntaxEnd: number,
  context: InlineAccumulator["context"],
  image: boolean,
): Reference {
  const close = leaf(nodeId, image ? "ImageReferenceClose" : "ReferenceClose", context);
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

function linkOrImage(
  nodeId: number,
  offset: number,
  endOffset: number,
  sourceSpan: { end: number; start: number },
  context: InlineAccumulator["context"],
  media: "image" | "link",
  resourceKind: "direct" | "reference",
): SpannedNode<Image | ImageReference | Link | LinkReference> {
  const image = media === "image";
  const referenceNode = resourceKind === "reference";
  const prefix = image ? "Image" : "";
  const resourcePrefix = referenceNode ? "Reference" : "Link";
  const [start, end] = contentBounds(
    nodeId,
    `${prefix + resourcePrefix}Open`,
    `${prefix + resourcePrefix}Close`,
    context,
  );
  const children: PhrasingContent[] = [];
  inlineSequence(nodeId, offset, createInlineAccumulator(context, children), start, end);
  if (referenceNode) {
    const association = reference(nodeId, offset, endOffset, context, image);
    return image
      ? withSpan<ImageReference>({ type: "imageReference", alt: phrasingText(children), ...association }, sourceSpan.start, sourceSpan.end)
      : withSpan<LinkReference>({ type: "linkReference", children, ...association }, sourceSpan.start, sourceSpan.end);
  }
  const closeIndex = leaf(nodeId, `${prefix}LinkClose`, context);
  const resource = destinationTitle(inlineTokenText(context.view.text, context.tokens, closeIndex).slice(2, -1));
  return image
    ? withSpan<Image>({ type: "image", alt: phrasingText(children), ...resource }, sourceSpan.start, sourceSpan.end)
    : withSpan<Link>({ type: "link", children, ...resource }, sourceSpan.start, sourceSpan.end);
}

function buildMedia(media: "image" | "link", resourceKind: "direct" | "reference"): InlineNodeBuilder {
  return (nodeId, offset, endOffset, sourceSpan, accumulator) => {
    appendInline(
      accumulator,
      linkOrImage(nodeId, offset, endOffset, sourceSpan, accumulator.context, media, resourceKind),
    );
    return true;
  };
}

const buildInlineImage = buildMedia("image", "direct");
const buildInlineReferenceImage = buildMedia("image", "reference");
const buildInlineLink = buildMedia("link", "direct");
const buildInlineReferenceLink = buildMedia("link", "reference");

export const feature: SyntaxFeature = {
  inline: {
    syntax: [
      {
        kind: "pair",
        open: "LinkOpen",
        close: "LinkClose",
        build: buildInlineLink,
      },
      {
        kind: "pair",
        open: "ImageLinkOpen",
        close: "ImageLinkClose",
        build: buildInlineImage,
      },
      {
        kind: "pair",
        open: "ReferenceOpen",
        close: "ReferenceClose",
        build: buildInlineReferenceLink,
      },
      {
        kind: "pair",
        open: "ImageReferenceOpen",
        close: "ImageReferenceClose",
        build: buildInlineReferenceImage,
      },
      {
        kind: "fallback",
        build: buildInlineChildren,
        tokens: [
          "ImageOpen",
          "BracketOpen",
          "LinkTail",
          "ReferenceTail",
          "ShortcutReferenceTail",
          "ReferenceSeparatorClose",
          "LinkOpen",
          "LinkClose",
          "ImageLinkOpen",
          "ImageLinkClose",
          "ReferenceOpen",
          "ReferenceClose",
          "ImageReferenceOpen",
          "ImageReferenceClose",
        ],
      },
      {
        kind: "leaf",
        token: "Autolink",
        build(tokenIndex, sourceSpan, accumulator) {
          const { context } = accumulator;
          const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
          const label = text.slice(1, -1);
          appendInline(accumulator, withSpan<Link>({
            type: "link",
            url: label.includes(":") ? label : `mailto:${label}`,
            title: null,
            children: [
              withSpan<Text>({ type: "text", value: label }, sourceSpan.start + 1, sourceSpan.end - 1),
            ],
          }, sourceSpan.start, sourceSpan.end));
          return true;
        },
      },
      { kind: "leaf", token: "BracketOpen", build: buildInlineText },
      { kind: "leaf", token: "ImageOpen", build: buildInlineText },
      { kind: "leaf", token: "LinkTail", build: buildInlineText },
      { kind: "leaf", token: "ReferenceTail", build: buildInlineText },
      { kind: "leaf", token: "ShortcutReferenceTail", build: buildInlineText },
      { kind: "leaf", token: "ReferenceSeparatorClose", build: buildInlineText },
    ],
  },
};
