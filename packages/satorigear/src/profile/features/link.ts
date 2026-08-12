import type { PhrasingContent } from "mdast";
import {
  appendInline,
  appendInlineSequence,
  contentBounds,
  createInlineAccumulator,
  type InlineAccumulator,
  type InlineNodeBuilder,
  leaf,
} from "../../fragment/inline.ts";
import { inlineTokenText } from "../../inline/tokens.ts";
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
  const prefix = image ? "Image" : "";
  const resourcePrefix = referenceNode ? "Reference" : "Link";

  return (nodeId, offset, endOffset, sourceSpan, accumulator) => {
    const context = accumulator.context;
    const [start, end] = contentBounds(
      nodeId,
      `${prefix + resourcePrefix}Open`,
      `${prefix + resourcePrefix}Close`,
      context,
    );
    const children: SpannedNode<PhrasingContent>[] = [];
    appendInlineSequence(nodeId, offset, createInlineAccumulator(context, children), start, end);
    if (referenceNode) {
      const association = reference(nodeId, offset, endOffset, context, image);
      appendInline(
        accumulator,
        image
          ? { type: "imageReference", alt: phrasingText(children), ...association, position: sourceSpan }
          : { type: "linkReference", children, ...association, position: sourceSpan },
      );
    }
    else {
      const closeIndex = leaf(nodeId, `${prefix}LinkClose`, context);
      const resource = destinationTitle(inlineTokenText(context.view.text, context.tokens, closeIndex).slice(2, -1));
      appendInline(
        accumulator,
        image
          ? { type: "image", alt: phrasingText(children), ...resource, position: sourceSpan }
          : { type: "link", children, ...resource, position: sourceSpan },
      );
    }
    return true;
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
        kind: "leaf",
        token: "Autolink",
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
      { kind: "leaf", token: "BracketOpen", build: buildInlineText },
      { kind: "leaf", token: "ImageOpen", build: buildInlineText },
      { kind: "leaf", token: "LinkTail", build: buildInlineText },
      { kind: "leaf", token: "ReferenceTail", build: buildInlineText },
      { kind: "leaf", token: "ShortcutReferenceTail", build: buildInlineText },
      { kind: "leaf", token: "ReferenceSeparatorClose", build: buildInlineText },
    ],
  },
};
