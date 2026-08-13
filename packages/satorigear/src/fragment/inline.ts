import type { PhrasingContent } from "mdast";
import {
  inlineTokenCount,
  inlineTokenEnd,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
} from "../inline/tokens.ts";
import { extendSpan, type SpannedNode } from "./node.ts";
import type { InlineSyntaxSchema } from "../inline/profile.ts";
import type { SourceSpan, SourceView } from "../source-view.ts";
import type { BlockBuildContext } from "./block.ts";

export interface InlineBuildContext {
  blockRule: string;
  decodeText: (value: string) => string;
  schema: InlineSyntaxSchema;
  source: string;
  tokenBuilders: readonly (InlineLeafBuilder | undefined)[];
  tokens: InlineTokenStream;
  view: SourceView;
}

export interface InlineAccumulator {
  context: InlineBuildContext;
  cursor: number | undefined;
  gapEnd: number;
  gapStart: number;
  target: SpannedNode<PhrasingContent>[];
}

export type InlineLeafBuilder = (
  tokenIndex: number,
  sourceSpan: SourceSpan,
  accumulator: InlineAccumulator,
) => boolean;

export type InlineNodeBuilder = (
  openToken: number,
  closeToken: number,
  children: SpannedNode<PhrasingContent>[],
  sourceSpan: SourceSpan,
  accumulator: InlineAccumulator,
) => void;

function lineStart(source: string, offset: number): number {
  while (offset > 0) {
    const character = source.charCodeAt(--offset);
    if (character === 10 || character === 13) {
      return offset + 1;
    }
  }
  return 0;
}

export function lineEnd(source: string, offset: number, limit = source.length): number {
  for (; offset < limit; offset++) {
    const character = source.charCodeAt(offset);
    if (character === 10 || character === 13) {
      return offset;
    }
  }
  return limit;
}

function lineEndingStart(source: string, offset: number): number {
  const start = lineStart(source, offset);
  if (start === 0) {
    return offset;
  }
  return source[start - 1] === "\n" && source[start - 2] === "\r" ? start - 2 : start - 1;
}

function appendText(target: SpannedNode<PhrasingContent>[], value: string, start: number, end: number): void {
  if (!value) {
    return;
  }
  const previous = target.at(-1);
  if (previous?.type === "text" && !("attributes" in previous)) {
    previous.value += value;
    extendSpan(previous, end);
  }
  else {
    target.push({ type: "text", value, position: { start, end } });
  }
}

function appendPhrasing(
  target: SpannedNode<PhrasingContent>[],
  value: SpannedNode<PhrasingContent>,
): void {
  if (value.type === "text") {
    appendText(target, value.value, value.position.start, value.position.end);
  }
  else {
    target.push(value);
  }
}

export function createInlineAccumulator(
  context: InlineBuildContext,
  target: SpannedNode<PhrasingContent>[],
  cursor?: number,
): InlineAccumulator {
  return { context, cursor, gapEnd: -1, gapStart: -1, target };
}

function appendInlineGap(accumulator: InlineAccumulator, start: number, end: number): void {
  accumulator.gapStart = -1;
  accumulator.gapEnd = -1;
  const { context, target } = accumulator;
  const gapSpan = context.view.mapSpan(start, end);
  appendText(
    target,
    context.decodeText(context.view.text.slice(start, end).replace(/[\r\n]/g, "")),
    gapSpan.start,
    gapSpan.end,
  );
}

export function appendInline(
  accumulator: InlineAccumulator,
  value: SpannedNode<PhrasingContent>,
): void {
  const { context, target } = accumulator;
  const nextLineOffset = value.position.start;
  const newline = value.type === "text" && value.value.startsWith("\n");
  if (accumulator.gapStart >= 0) {
    if (!newline) {
      appendInlineGap(accumulator, accumulator.gapStart, accumulator.gapEnd);
    }
    else {
      accumulator.gapStart = -1;
      accumulator.gapEnd = -1;
    }
  }
  if (newline) {
    // Markdown syntax newlines point past stripped container prefixes,
    // while mdast spans include the physical line ending.
    const previous = target.at(-1);
    if (previous?.type === "break") {
      extendSpan(previous, lineStart(context.source, nextLineOffset));
      return;
    }
    value.position.start = lineEndingStart(context.source, nextLineOffset);
    if (previous?.type === "text") {
      previous.value = previous.value.slice(0, trailingWhitespaceStart(previous.value));
    }
  }
  appendPhrasing(target, value);
}

function appendInlineLeaf(
  tokenIndex: number,
  sourceSpan: SourceSpan,
  accumulator: InlineAccumulator,
): boolean {
  const { context } = accumulator;
  const build = context.tokenBuilders[inlineTokenKind(context.tokens, tokenIndex)];
  if (!build) {
    throw new Error(`Unexpected inline token kind ${inlineTokenKind(context.tokens, tokenIndex)}`);
  }
  return build(tokenIndex, sourceSpan, accumulator);
}

function trailingWhitespaceStart(value: string): number {
  let offset = value.length;
  while (offset > 0 && (value[offset - 1] === " " || value[offset - 1] === "\t")) {
    offset--;
  }
  return offset;
}

// Resolution has already made semantic pairs unambiguous, so projection can consume that stream
// directly instead of copying it into a second syntax arena.
function appendInlineRange(
  startToken: number,
  endToken: number,
  accumulator: InlineAccumulator,
  closeKind?: number,
): number {
  const { context } = accumulator;
  let index = startToken;
  while (index < endToken) {
    const kind = inlineTokenKind(context.tokens, index);
    if (kind === closeKind) {
      break;
    }
    const childOffset = inlineTokenStart(context.tokens, index);
    if (accumulator.cursor !== void 0 && childOffset > accumulator.cursor) {
      accumulator.gapStart = accumulator.cursor;
      accumulator.gapEnd = childOffset;
    }
    const next = buildInlineSemantic(index, endToken, accumulator);
    const childEnd = inlineTokenEnd(context.tokens, next === void 0 ? index : next - 1);
    const childEmitted = next === void 0
      ? appendInlineLeaf(
        index,
        context.view.mapSpan(childOffset, childEnd),
        accumulator,
      )
      : true;
    index = next ?? index + 1;
    if (!childEmitted) {
      continue;
    }
    accumulator.cursor = childEnd;
  }
  return index;
}

function buildInlineSemantic(
  openToken: number,
  endToken: number,
  accumulator: InlineAccumulator,
): number | undefined {
  const { context } = accumulator;
  const kind = inlineTokenKind(context.tokens, openToken);
  const container = context.schema.containerByKind[kind];
  if (container) {
    let closeToken = openToken;
    let next = openToken + 1;
    const children: SpannedNode<PhrasingContent>[] = [];
    if (
      next < endToken &&
      inlineTokenKind(context.tokens, next) === container.contentOpenKind
    ) {
      const contentStart = inlineTokenEnd(context.tokens, next++);
      const childAccumulator = createInlineAccumulator(context, children, contentStart);
      closeToken = appendInlineRange(
        next,
        endToken,
        childAccumulator,
        container.closeKind,
      );
      if (
        closeToken >= endToken ||
        inlineTokenKind(context.tokens, closeToken) !== container.closeKind
      ) {
        throw new Error(`Resolved inline stream did not close token kind ${kind}`);
      }
      const contentEnd = inlineTokenStart(context.tokens, closeToken);
      if (childAccumulator.cursor !== void 0 && contentEnd > childAccumulator.cursor) {
        appendInlineGap(childAccumulator, childAccumulator.cursor, contentEnd);
      }
      next = closeToken + 1;
    }
    container.build(
      openToken,
      closeToken,
      children,
      context.view.mapSpan(
        inlineTokenStart(context.tokens, openToken),
        inlineTokenEnd(context.tokens, closeToken),
      ),
      accumulator,
    );
    return next;
  }

  const pair = context.schema.pairByOpenKind[kind];
  if (!pair) {
    return;
  }
  const contentStart = inlineTokenEnd(context.tokens, openToken);
  const children: SpannedNode<PhrasingContent>[] = [];
  const childAccumulator = createInlineAccumulator(context, children, contentStart);
  const closeToken = appendInlineRange(
    openToken + 1,
    endToken,
    childAccumulator,
    pair.closeKind,
  );
  if (
    closeToken >= endToken ||
    inlineTokenKind(context.tokens, closeToken) !== pair.closeKind
  ) {
    throw new Error(`Resolved inline stream did not close token kind ${kind}`);
  }
  const contentEnd = inlineTokenStart(context.tokens, closeToken);
  if (childAccumulator.cursor !== void 0 && contentEnd > childAccumulator.cursor) {
    appendInlineGap(childAccumulator, childAccumulator.cursor, contentEnd);
  }
  pair.build(
    openToken,
    closeToken,
    children,
    context.view.mapSpan(
      inlineTokenStart(context.tokens, openToken),
      inlineTokenEnd(context.tokens, closeToken),
    ),
    accumulator,
  );
  return closeToken + 1;
}

export function buildInlineChildren(
  nodeId: number,
  context: BlockBuildContext,
  allowEmpty = false,
): SpannedNode<PhrasingContent>[] {
  const region = context.inline.take(nodeId);
  if (!region) {
    const rule = context.view.arena.ruleNameOf(nodeId);
    if (allowEmpty) {
      return [];
    }
    throw new Error(`Expected ${rule} syntax to contain inline content`);
  }
  const inlineContext: InlineBuildContext = {
    blockRule: region.rule,
    decodeText: context.profile.inline.decodeText,
    schema: context.profile.inline.schema,
    source: context.source,
    tokenBuilders: context.profile.inline.tokenBuilders,
    tokens: region.tokens,
    view: region.view,
  };
  const result: SpannedNode<PhrasingContent>[] = [];
  appendInlineRange(
    0,
    inlineTokenCount(region.tokens),
    createInlineAccumulator(inlineContext, result),
  );
  const last = result.at(-1);
  if (last?.type === "text") {
    const end = trailingWhitespaceStart(last.value);
    const removed = last.value.length - end;
    last.value = last.value.slice(0, end);
    last.position.end -= removed;
    if (!last.value) {
      result.pop();
    }
  }
  return result;
}
