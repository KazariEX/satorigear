import type { Image, ImageReference, Link, LinkReference, PhrasingContent, Text } from "mdast";
import { inlineTokenText } from "../../inline/runtime.ts";
import {
  appendInline,
  contentBounds,
  createInlineAccumulator,
  type InlineAccumulator,
  type InlineRuleProjector,
  inlineSequence,
  leaf,
  projectInlineChildren,
  projectInlineIgnore,
  withSpan,
} from "../../mdast.ts";
import { normalizeReferenceLabel } from "./reference.ts";
import { projectInlineText, semanticText } from "./text.ts";
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
  tokenBase: number,
  syntaxStart: number,
  syntaxEnd: number,
  context: InlineAccumulator["context"],
  image: boolean,
): Reference {
  const close = leaf(nodeId, tokenBase, image ? "ImageReferenceClose" : "ReferenceClose", context);
  const closeText = inlineTokenText(context.view.text, context.tokens, close);
  const text = context.view.text.slice(syntaxStart, syntaxEnd);
  const content = text.slice(image ? 2 : 1, text.length - closeText.length);
  const full = closeText.startsWith("][") && closeText !== "][]";
  const labelSource = full ? closeText.slice(2, -1) : content;
  return {
    identifier: normalizeReferenceLabel(labelSource).toLowerCase(),
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
  tokenBase: number,
  endOffset: number,
  sourceSpan: { end: number; start: number },
  context: InlineAccumulator["context"],
  media: "image" | "link",
  resourceKind: "direct" | "reference",
): Image | ImageReference | Link | LinkReference {
  const image = media === "image";
  const referenceNode = resourceKind === "reference";
  const prefix = image ? "Image" : "";
  const resourcePrefix = referenceNode ? "Reference" : "Link";
  const [start, end] = contentBounds(nodeId, tokenBase, [`${prefix}${resourcePrefix}Open`], [`${prefix}${resourcePrefix}Close`], context);
  const children: PhrasingContent[] = [];
  inlineSequence(nodeId, offset, tokenBase, createInlineAccumulator(context, children), start, end);
  if (referenceNode) {
    const association = reference(nodeId, tokenBase, offset, endOffset, context, image);
    return image
      ? withSpan<ImageReference>({ type: "imageReference", alt: phrasingText(children), ...association }, sourceSpan.start, sourceSpan.end)
      : withSpan<LinkReference>({ type: "linkReference", children, ...association }, sourceSpan.start, sourceSpan.end);
  }
  const closeIndex = leaf(nodeId, tokenBase, `${prefix}LinkClose`, context);
  const resource = destinationTitle(inlineTokenText(context.view.text, context.tokens, closeIndex).slice(2, -1));
  return image
    ? withSpan<Image>({ type: "image", alt: phrasingText(children), ...resource }, sourceSpan.start, sourceSpan.end)
    : withSpan<Link>({ type: "link", children, ...resource }, sourceSpan.start, sourceSpan.end);
}

function projectMedia(media: "image" | "link", resourceKind: "direct" | "reference"): InlineRuleProjector {
  return (nodeId, offset, tokenBase, endOffset, sourceSpan, accumulator) => {
    appendInline(
      accumulator,
      linkOrImage(nodeId, offset, tokenBase, endOffset, sourceSpan, accumulator.context, media, resourceKind),
      sourceSpan.start,
    );
    return true;
  };
}

const projectInlineImage = projectMedia("image", "direct");
const projectInlineReferenceImage = projectMedia("image", "reference");

export const feature: SyntaxFeature = {
  inlineRules: [
    { rule: "LinkContent", project: projectInlineChildren },
    { rule: "BracketFallback", project: projectInlineChildren },
    { rule: "Image", project: projectInlineImage },
    { rule: "LinkImage", project: projectInlineImage },
    { rule: "ReferenceImage", project: projectInlineReferenceImage },
    { rule: "LinkReferenceImage", project: projectInlineReferenceImage },
    { rule: "Link", project: projectMedia("link", "direct") },
    { rule: "ReferenceLink", project: projectMedia("link", "reference") },
  ],
  inlineTokens: [
    {
      token: "Autolink",
      project(tokenIndex, sourceSpan, accumulator) {
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
        }, sourceSpan.start, sourceSpan.end), sourceSpan.start);
        return true;
      },
    },
    { token: "BracketOpen", project: projectInlineText },
    { token: "ImageOpen", project: projectInlineText },
    { token: "LinkTail", project: projectInlineText },
    { token: "ReferenceTail", project: projectInlineText },
    { token: "ShortcutReferenceTail", project: projectInlineText },
    { token: "ReferenceSeparatorClose", project: projectInlineText },
    { token: "LinkOpen", project: projectInlineIgnore },
    { token: "LinkClose", project: projectInlineIgnore },
    { token: "ReferenceOpen", project: projectInlineIgnore },
    { token: "ReferenceClose", project: projectInlineIgnore },
    { token: "ImageLinkOpen", project: projectInlineIgnore },
    { token: "ImageLinkClose", project: projectInlineIgnore },
    { token: "ImageReferenceOpen", project: projectInlineIgnore },
    { token: "ImageReferenceClose", project: projectInlineIgnore },
  ],
};
