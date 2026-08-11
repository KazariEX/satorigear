import type {
  BlockContent,
  DefinitionContent,
  Node,
  PhrasingContent,
  Root,
  Text,
  TopLevelContent,
} from "mdast";
import { type BlockToken, tokenEnd, tokenStart } from "./block/tokens.ts";
import {
  inlineTokenCount,
  inlineTokenEnd,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
} from "./inline/tokens.ts";
import type { BlockSyntaxView } from "./block/arena.ts";
import type { InlineArena } from "./inline/arena.ts";
import type { SyntaxProfile } from "./profile/types.ts";
import type { SourceLocation, SourceSpan, SourceView } from "./source-view.ts";
import type { SyntaxBlock, SyntaxState } from "./syntax-state.ts";

export interface BlockBuildContext {
  profile: SyntaxProfile;
  source: string;
  syntaxState: SyntaxState;
  view: BlockSyntaxView;
}

interface FragmentValue {
  [key: string]: unknown;
  children?: FragmentValue[];
  endOffset: number;
  startOffset: number;
}

export type FragmentNode<T extends object = Node> = T & FragmentValue;

export interface BlockFragment {
  node: FragmentNode<TopLevelContent>;
  // Origin belongs to the cached fragment; offset moves so positions can shift without rebuilding nodes.
  offset: number;
  origin: number;
  version: number;
}

// Core owns fragment state and traversal; profiles supply every syntax-specific node builder.
export type BlockNodeBuilder = (
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockBuildContext,
) => FragmentNode<TopLevelContent>;

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

export function withSpan<const T extends object>(value: T, start: number, end: number): FragmentNode<T> {
  const fragment = value as FragmentNode<T>;
  fragment.startOffset = start;
  fragment.endOffset = end;
  return fragment;
}

export function extendSpan(value: object, end: number): void {
  const fragment = value as FragmentValue;
  fragment.endOffset = Math.max(fragment.endOffset, end);
}

export function blockEnd(nodeId: number, offset: number, context: BlockBuildContext): number {
  let end = offset + context.view.arena.lenOf(nodeId);
  if (end > offset && context.source[end - 1] === "\n") {
    end--;
  }
  if (end > offset && context.source[end - 1] === "\r") {
    end--;
  }
  return end;
}

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

export function firstChildStart(value: { children: readonly object[] }): number {
  const first = value.children[0];
  if (!first) {
    throw new Error("mdast container unexpectedly has no children");
  }
  return (first as FragmentValue).startOffset;
}

export function lastChildEnd(value: { children: readonly object[] }, emptyEnd: number): number {
  const last = value.children.at(-1);
  return last ? (last as FragmentValue).endOffset : emptyEnd;
}

export function firstNonspace(source: string, start: number, end: number): number {
  while (start < end && (source[start] === " " || source[start] === "\t")) {
    start++;
  }
  return start;
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

export function directBlockToken(
  nodeId: number,
  tokenBase: number,
  tokenType: string,
  context: BlockBuildContext,
): BlockToken | undefined {
  const arena = context.view.arena;
  const childCount = arena.childCount(nodeId);
  for (let index = 0; index < childCount; index++) {
    const entry = arena.childAt(nodeId, index);
    if (entry < 0) {
      const token = context.view.tokenAt(arena.leafToken(entry, tokenBase));
      if (token.type === tokenType) {
        return token;
      }
    }
  }
}

export function blockToken(
  nodeId: number,
  tokenBase: number,
  tokenType: string,
  context: BlockBuildContext,
): BlockToken {
  const token = directBlockToken(nodeId, tokenBase, tokenType, context);
  if (!token) {
    throw new Error(`Expected ${context.view.arena.ruleNameOf(nodeId)} syntax to contain ${tokenType}`);
  }
  return token;
}

export function payloadBounds(
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockBuildContext,
): SourceSpan {
  const arena = context.view.arena;
  const result = { start: offset + arena.lenOf(nodeId), end: offset };
  const visit = (currentId: number, currentTokenBase: number): void => {
    const childCount = arena.childCount(currentId);
    for (let index = 0; index < childCount; index++) {
      const child = arena.childAt(currentId, index);
      if (child < 0) {
        const token = context.view.tokenAt(arena.leafToken(child, currentTokenBase));
        const start = tokenStart(token);
        const end = tokenEnd(token);
        if (end > start) {
          result.start = Math.min(result.start, start);
          result.end = Math.max(result.end, end);
        }
      }
      else {
        visit(child, currentTokenBase + arena.childTokRelAt(currentId, index));
      }
    }
  };
  visit(nodeId, tokenBase);
  return result;
}

export function normalizeLines(value: string): string {
  return value.replace(/\r\n|\r/g, "\n");
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
    const fragment = value as PhrasingContent & FragmentValue;
    appendText(target, value.value, fragment.startOffset, fragment.endOffset);
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
  value: FragmentNode<PhrasingContent>,
): void {
  const { context, target } = accumulator;
  const nextLineOffset = value.startOffset;
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
    (value as PhrasingContent & FragmentValue).startOffset = lineEndingStart(context.source, nextLineOffset);
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
    (last as PhrasingContent & FragmentValue).endOffset -= removed;
    if (!last.value) {
      result.pop();
    }
  }
  return result;
}

export function blockChildren(
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockBuildContext,
): (BlockContent | DefinitionContent)[] {
  const arena = context.view.arena;
  const children: (BlockContent | DefinitionContent)[] = [];
  const childCount = arena.childCount(nodeId);
  for (let index = 0; index < childCount; index++) {
    const childId = arena.childAt(nodeId, index);
    if (childId >= 0 && context.view.arena.isBlock(childId)) {
      children.push(blockNode(
        childId,
        offset + arena.childRelAt(nodeId, index),
        tokenBase + arena.childTokRelAt(nodeId, index),
        context,
      ) as BlockContent | DefinitionContent);
    }
  }
  return children;
}

function blockNode(
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockBuildContext,
): FragmentNode<TopLevelContent> {
  const arena = context.view.arena;
  const rule = arena.ruleOf(nodeId);
  const build = rule.build;
  if (!build) {
    throw new Error(`Unexpected block syntax rule: ${rule.name}`);
  }
  return build(nodeId, offset, tokenBase, context);
}

export function buildBlockFragment(
  block: SyntaxBlock,
  context: BlockBuildContext,
): BlockFragment {
  const node = blockNode(block.handle.id, block.offset, block.tokenBase, context);
  return {
    node,
    offset: block.offset,
    origin: block.offset,
    version: block.version,
  };
}

function materializeNode(
  value: FragmentValue,
  shift: number,
  point: (offset: number) => SourceLocation,
): Node {
  const result = {} as Node & Record<string, unknown>;
  // Preserve start → children → end order for the tokenizer's forward source locator.
  const start = point(shift + value.startOffset);
  for (const key in value) {
    if (key !== "startOffset" && key !== "endOffset" && key !== "children") {
      result[key] = value[key];
    }
  }
  const childrenTarget = value.children;
  if (childrenTarget) {
    const children = new Array<Node>(childrenTarget.length);
    for (let i = 0; i < childrenTarget.length; i++) {
      children[i] = materializeNode(childrenTarget[i], shift, point);
    }
    result.children = children;
  }
  result.position = {
    start,
    end: point(shift + value.endOffset),
  };
  return result;
}

export function materialize(
  fragments: readonly BlockFragment[],
  sourceLength: number,
  locate: (offset: number) => SourceLocation,
): Root {
  const start = locate(0);
  const children = fragments.map((fragment) => materializeNode(
    fragment.node,
    fragment.offset - fragment.origin,
    locate,
  ) as TopLevelContent);
  return {
    type: "root",
    children,
    position: { start, end: locate(sourceLength) },
  };
}
