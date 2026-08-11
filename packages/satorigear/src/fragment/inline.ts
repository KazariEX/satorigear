import type { PhrasingContent, Text } from "mdast";
import {
  inlineTokenCount,
  inlineTokenEnd,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
} from "../inline/tokens.ts";
import { extendSpan, type SpannedNode, type SpannedValue, withSpan } from "./node.ts";
import type { InlineArena } from "../inline/arena.ts";
import type { SourceSpan, SourceView } from "../source-view.ts";
import type { BlockBuildContext } from "./block.ts";

export interface InlineBuildContext {
  arena: InlineArena;
  blockRule: string;
  decodeText: (value: string) => string;
  source: string;
  tokenBase: number;
  tokenBuilders: readonly (InlineLeafBuilder | undefined)[];
  tokens: InlineTokenStream;
  view: SourceView;
}

export interface InlineAccumulator {
  context: InlineBuildContext;
  gapEnd: number;
  gapStart: number;
  target: PhrasingContent[];
}

export type InlineLeafBuilder = (
  tokenIndex: number,
  sourceSpan: SourceSpan,
  accumulator: InlineAccumulator,
) => boolean;

export type InlineNodeBuilder = (
  nodeId: number,
  offset: number,
  endOffset: number,
  sourceSpan: SourceSpan,
  accumulator: InlineAccumulator,
) => boolean;

export const buildInlineChildren: InlineNodeBuilder = (
  nodeId,
  offset,
  endOffset,
  sourceSpan,
  accumulator,
) => inlineSequence(nodeId, offset, accumulator);

function inlineTokenIndex(context: InlineBuildContext, index: number): number {
  const tokenIndex = index - context.tokenBase;
  if (tokenIndex < 0 || tokenIndex >= inlineTokenCount(context.tokens)) {
    throw new Error("inline arena returned a leaf outside its token stream");
  }
  return tokenIndex;
}

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

export function directLeaf(
  nodeId: number,
  tokenType: string,
  context: InlineBuildContext,
): number | undefined {
  const { arena } = context;
  const childCount = arena.childCount(nodeId);
  for (let index = 0; index < childCount; index++) {
    const entry = arena.childAt(nodeId, index);
    if (
      entry < 0 && arena.leafTokenType(entry) === tokenType
    ) {
      return inlineTokenIndex(context, arena.leafToken(entry));
    }
  }
}

export function leaf(nodeId: number, tokenType: string, context: InlineBuildContext): number {
  const result = directLeaf(nodeId, tokenType, context);
  if (result === void 0) {
    throw new Error(`Expected inline syntax to contain ${tokenType}`);
  }
  return result;
}

function appendText(target: PhrasingContent[], value: string, start: number, end: number): void {
  if (!value) {
    return;
  }
  const previous = target.at(-1);
  if (previous?.type === "text" && !("attributes" in previous)) {
    previous.value += value;
    extendSpan(previous, end);
  }
  else {
    target.push(withSpan<Text>({ type: "text", value }, start, end));
  }
}

function appendPhrasing(target: PhrasingContent[], value: PhrasingContent): void {
  if (value.type === "text") {
    const node = value as PhrasingContent & SpannedValue;
    appendText(target, value.value, node.position.start, node.position.end);
  }
  else {
    target.push(value);
  }
}

export function createInlineAccumulator(
  context: InlineBuildContext,
  target: PhrasingContent[],
): InlineAccumulator {
  return { context, gapEnd: -1, gapStart: -1, target };
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
    (value as unknown as SpannedValue).position.start = lineEndingStart(context.source, nextLineOffset);
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

export function contentBounds(
  nodeId: number,
  openType: string,
  closeType: string,
  context: InlineBuildContext,
): [number, number] {
  return [
    inlineTokenEnd(context.tokens, leaf(nodeId, openType, context)),
    inlineTokenStart(context.tokens, leaf(nodeId, closeType, context)),
  ];
}

function trailingWhitespaceStart(value: string): number {
  let offset = value.length;
  while (offset > 0 && (value[offset - 1] === " " || value[offset - 1] === "\t")) {
    offset--;
  }
  return offset;
}

export function inlineSequence(
  nodeId: number,
  offset: number,
  accumulator: InlineAccumulator,
  start?: number,
  end?: number,
): boolean {
  const { context } = accumulator;
  let cursor = start;
  let emitted = false;
  const { arena } = context;
  const childCount = arena.childCount(nodeId);
  for (let index = 0; index < childCount; index++) {
    const entry = arena.childAt(nodeId, index);
    const tokenIndex = entry < 0 ? inlineTokenIndex(context, arena.leafToken(entry)) : void 0;
    const childOffset = tokenIndex !== void 0
      ? inlineTokenStart(context.tokens, tokenIndex)
      : offset + arena.childRelAt(nodeId, index);
    const childEnd = tokenIndex !== void 0
      ? inlineTokenEnd(context.tokens, tokenIndex)
      : childOffset + arena.lenOf(entry);
    const sourceSpan = context.view.mapSpan(childOffset, childEnd);
    if (cursor !== void 0 && childOffset > cursor) {
      accumulator.gapStart = cursor;
      accumulator.gapEnd = childOffset;
    }
    const childEmitted = tokenIndex !== void 0
      ? appendInlineLeaf(tokenIndex, sourceSpan, accumulator)
      : appendInlineNode(entry, childOffset, childEnd, sourceSpan, accumulator);
    if (!childEmitted) {
      continue;
    }
    emitted = true;
    cursor = childEnd;
  }
  if (cursor !== void 0 && end !== void 0 && end > cursor) {
    appendInlineGap(accumulator, cursor, end);
    emitted = true;
  }
  return emitted;
}

function appendInlineNode(
  nodeId: number,
  offset: number,
  endOffset: number,
  sourceSpan: SourceSpan,
  accumulator: InlineAccumulator,
): boolean {
  const { context } = accumulator;
  const build = context.arena.builderOf(nodeId);
  if (!build) {
    throw new Error("Unexpected inline syntax rule");
  }
  return build(nodeId, offset, endOffset, sourceSpan, accumulator);
}

export function inlineChildren(
  nodeId: number,
  context: BlockBuildContext,
  allowEmpty = false,
): PhrasingContent[] {
  const inline = context.syntaxState.inlineForBlock(nodeId);
  if (!inline) {
    const rule = context.view.arena.ruleNameOf(nodeId);
    if (allowEmpty) {
      return [];
    }
    throw new Error(`Expected ${rule} syntax to contain InlineLines`);
  }
  const inlineContext: InlineBuildContext = {
    arena: inline.arena,
    blockRule: inline.blockRule,
    decodeText: context.profile.inline.decodeText,
    source: context.source,
    tokenBase: inline.rootTokenBase,
    tokenBuilders: context.profile.inline.tokenBuilders,
    tokens: inline.tokens,
    view: inline.view,
  };
  const result: PhrasingContent[] = [];
  inlineSequence(
    inline.rootId,
    inline.rootOffset,
    createInlineAccumulator(inlineContext, result),
  );
  const last = result.at(-1);
  if (last?.type === "text") {
    const end = trailingWhitespaceStart(last.value);
    const removed = last.value.length - end;
    last.value = last.value.slice(0, end);
    (last as unknown as SpannedValue).position.end -= removed;
    if (!last.value) {
      result.pop();
    }
  }
  return result;
}
