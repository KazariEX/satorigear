import type { Blockquote, Heading, List, Paragraph, PhrasingContent } from "mdast";
import {
  appendInlineToken,
  copyInlineToken,
  firstInlineTokenEndingAfter,
  inlineKind,
  inlineTokenCount,
  inlineTokenEnd,
  inlineTokenFlags,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
  setInlineTokenFlags,
} from "../../../inline/tokens.ts";
import { extendSpan, type FragmentNode, lineEnd } from "../../../mdast.ts";
import {
  carryTerminalAttributes,
  hasTerminalAttributes,
  mergeAttributes,
  takeTerminalAttributes,
} from "./carrier.ts";
import { attributesEnd, parseAttributes } from "./syntax.ts";
import type { BlockProjectorDecorator, SyntaxFeature } from "../../types.ts";
import type { Attributes } from "./types.ts";

interface AttributeRange {
  detached: boolean;
  end: number;
  start: number;
}

const attributesKind = inlineKind("Attributes");
const boundaryKind = inlineKind("InlineBoundary");
const textKind = inlineKind("Text");
const detachedFlag = 4;
const terminalFlag = 8;

const decorateInlineContainer: BlockProjectorDecorator = (project) => (nodeId, offset, tokenBase, context) => {
  const result = project(nodeId, offset, tokenBase, context) as FragmentNode<Paragraph | Heading>;
  const attributes = takeTerminalAttributes(result.children);
  if (attributes) {
    result.attributes = attributes;
  }
  return result;
};

const decorateList: BlockProjectorDecorator = (project) => (nodeId, offset, tokenBase, context) => {
  const result = project(nodeId, offset, tokenBase, context) as FragmentNode<List>;
  if (!result.spread) {
    for (const item of result.children) {
      const paragraph = !item.spread && item.children.length === 1 && item.children[0].type === "paragraph"
        ? item.children[0]
        : void 0;
      if (paragraph?.attributes) {
        item.attributes = paragraph.attributes;
        delete paragraph.attributes;
      }
    }
  }
  return result;
};

const decorateBlockquote: BlockProjectorDecorator = (project) => (nodeId, offset, tokenBase, context) => {
  const result = project(nodeId, offset, tokenBase, context) as FragmentNode<Blockquote>;
  const paragraph = result.children.length === 1 && result.children[0].type === "paragraph"
    ? result.children[0]
    : void 0;
  if (paragraph?.attributes) {
    result.attributes = paragraph.attributes;
    delete paragraph.attributes;
  }
  return result;
};

function isMarkdownWhitespace(code: number): boolean {
  return code === 9 || code === 10 || code === 13 || code === 32;
}

function hasVisibleText(source: string, start: number, end: number): boolean {
  for (let offset = start; offset < end; offset++) {
    if (!isMarkdownWhitespace(source.charCodeAt(offset))) {
      return true;
    }
  }
  return false;
}

function rangesOf(source: string, tokens: InlineTokenStream): AttributeRange[] {
  const ranges: AttributeRange[] = [];
  let consumedEnd = 0;
  let hasContent = false;
  let regionEnd = source.length;
  const boundaries: number[] = [];
  for (let index = 0; index < inlineTokenCount(tokens); index++) {
    if (inlineTokenKind(tokens, index) === boundaryKind) {
      boundaries.push(inlineTokenStart(tokens, index));
    }
  }
  regionEnd = boundaries[0] ?? source.length;
  let boundaryIndex = 0;
  let attributeLineEnd = 0;
  for (let index = 0; index < inlineTokenCount(tokens); index++) {
    const kind = inlineTokenKind(tokens, index);
    const start = inlineTokenStart(tokens, index);
    const end = inlineTokenEnd(tokens, index);
    while (boundaryIndex < boundaries.length && boundaries[boundaryIndex] <= start) {
      regionEnd = boundaries[boundaryIndex + 1] ?? source.length;
      boundaryIndex++;
      hasContent = false;
      attributeLineEnd = 0;
    }
    if (kind === boundaryKind || end <= consumedEnd) {
      continue;
    }
    if (kind !== textKind) {
      hasContent = true;
      continue;
    }
    let cursor = Math.max(start, consumedEnd);
    for (let offset = source.indexOf("{", cursor); offset >= cursor && offset < end;) {
      if (hasVisibleText(source, cursor, offset)) {
        hasContent = true;
      }
      const invalidPrefix = source[offset + 1] === "{" || source[offset - 1] === "{" || source[offset - 1] === "$";
      if (!invalidPrefix && offset >= attributeLineEnd) {
        attributeLineEnd = lineEnd(source, offset, regionEnd);
      }
      const parsedEnd = invalidPrefix ? void 0 : attributesEnd(source, offset, attributeLineEnd);
      if (parsedEnd === void 0) {
        hasContent = true;
        cursor = offset + 1;
        offset = source.indexOf("{", cursor);
        continue;
      }
      if (!hasContent) {
        cursor = parsedEnd;
        offset = source.indexOf("{", cursor);
        continue;
      }
      ranges.push({
        detached: offset > 0 && isMarkdownWhitespace(source.charCodeAt(offset - 1)),
        start: offset,
        end: parsedEnd,
      });
      consumedEnd = parsedEnd;
      cursor = parsedEnd;
      offset = source.indexOf("{", cursor);
    }
    if (hasVisibleText(source, cursor, end)) {
      hasContent = true;
    }
  }
  return ranges;
}

function copyRange(target: number[], tokens: InlineTokenStream, start: number, end: number): void {
  for (let index = firstInlineTokenEndingAfter(tokens, start); index < inlineTokenCount(tokens); index++) {
    const tokenStart = inlineTokenStart(tokens, index);
    if (tokenStart >= end) {
      break;
    }
    const tokenEnd = inlineTokenEnd(tokens, index);
    const fragmentStart = Math.max(start, tokenStart);
    const fragmentEnd = Math.min(end, tokenEnd);
    if (fragmentStart === tokenStart && fragmentEnd === tokenEnd) {
      copyInlineToken(target, tokens, index);
    }
    else {
      appendInlineToken(
        target,
        textKind,
        fragmentStart,
        fragmentEnd,
        fragmentStart === tokenStart ? inlineTokenFlags(tokens, index) : 0,
      );
    }
  }
}

export const feature: SyntaxFeature = {
  block: {
    decorators: [
      { rule: "Paragraph", decorate: decorateInlineContainer },
      { rule: "AtxHeading", decorate: decorateInlineContainer },
      { rule: "SetextHeading", decorate: decorateInlineContainer },
      { rule: "UnorderedList", decorate: decorateList },
      { rule: "OrderedList", decorate: decorateList },
      { rule: "BlockQuote", decorate: decorateBlockquote },
    ],
  },
  inline: {
    tokens: [
      {
        token: "Attributes",
        project(tokenIndex, sourceSpan, accumulator) {
          const previous = accumulator.target.at(-1) as (PhrasingContent & { attributes?: Attributes }) | undefined;
          const parsed = parseAttributes(accumulator.context.view.text, inlineTokenStart(accumulator.context.tokens, tokenIndex));
          if (!previous || !parsed) {
            return false;
          }
          const flags = inlineTokenFlags(accumulator.context.tokens, tokenIndex);
          const terminal = Boolean(flags & terminalFlag);
          const detached = Boolean(flags & detachedFlag);
          if (
            terminal && (
              detached ||
              previous.type === "text" ||
              hasTerminalAttributes(accumulator.target)
            )
          ) {
            carryTerminalAttributes(accumulator.target, parsed.attributes);
            return true;
          }
          if (previous.attributes) {
            mergeAttributes(previous.attributes, parsed.attributes);
          }
          else {
            previous.attributes = parsed.attributes;
          }
          extendSpan(previous, sourceSpan.end);
          return true;
        },
      },
    ],
    transform: transformInlineAttributes,
  },
};

function transformInlineAttributes(source: string, tokens: InlineTokenStream): InlineTokenStream {
  const ranges = rangesOf(source, tokens);
  if (ranges.length === 0) {
    return tokens;
  }
  const result: number[] = [];
  let cursor = 0;
  for (const range of ranges) {
    copyRange(result, tokens, cursor, range.start);
    appendInlineToken(result, attributesKind, range.start, range.end, range.detached ? detachedFlag : 0);
    cursor = range.end;
  }
  copyRange(result, tokens, cursor, source.length);
  let terminal = true;
  for (let index = inlineTokenCount(result) - 1; index >= 0; index--) {
    const kind = inlineTokenKind(result, index);
    if (kind === boundaryKind) {
      terminal = true;
    }
    else if (kind === attributesKind) {
      if (terminal) {
        setInlineTokenFlags(result, index, inlineTokenFlags(result, index) | terminalFlag);
      }
    }
    else if (
      kind !== textKind || hasVisibleText(
        source,
        inlineTokenStart(result, index),
        inlineTokenEnd(result, index),
      )
    ) {
      terminal = false;
    }
  }
  return result;
}
