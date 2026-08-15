import type { PhrasingContent } from "mdast";
import { Character } from "../constants/character.ts";
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
  tokenHandlers: readonly (InlineTokenHandler | undefined)[];
  tokens: InlineTokenStream;
  view: SourceView;
}

interface InlineOutput {
  // Nested semantic nodes share the region context but own their output position and gaps.
  cursor: number | undefined;
  gapEnd: number;
  gapStart: number;
  target: SpannedNode<PhrasingContent>[];
}

export type InlineLeafBuilder = (
  tokenIndex: number,
  sourceSpan: SourceSpan,
  context: InlineBuildContext,
) => SpannedNode<PhrasingContent> | undefined;

export type InlineNodeBuilder = (
  openToken: number,
  closeToken: number,
  sourceSpan: SourceSpan,
  children: SpannedNode<PhrasingContent>[],
  context: InlineBuildContext,
) => SpannedNode<PhrasingContent>;

export type InlineTokenDecorator = (
  tokenIndex: number,
  sourceSpan: SourceSpan,
  context: InlineBuildContext,
  target: SpannedNode<PhrasingContent>[],
) => boolean;

export type InlineTokenHandler = (
  tokenIndex: number,
  sourceSpan: SourceSpan,
  context: InlineBuildContext,
  target: SpannedNode<PhrasingContent>[],
) => SpannedNode<PhrasingContent> | boolean | undefined;

function lineStart(source: string, offset: number): number {
  while (offset > 0) {
    const character = source.charCodeAt(--offset);
    if (character === Character.LineFeed || character === Character.CarriageReturn) {
      return offset + 1;
    }
  }
  return 0;
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

function appendInlineGap(
  output: InlineOutput,
  context: InlineBuildContext,
  start: number,
  end: number,
): void {
  output.gapStart = -1;
  output.gapEnd = -1;
  const gapSpan = context.view.mapSpan(start, end);
  appendText(
    output.target,
    context.decodeText(context.view.text.slice(start, end).replace(/[\r\n]/g, "")),
    gapSpan.start,
    gapSpan.end,
  );
}

function appendInline(
  output: InlineOutput,
  context: InlineBuildContext,
  value: SpannedNode<PhrasingContent>,
): void {
  const { target } = output;
  const nextLineOffset = value.position.start;
  const newline = value.type === "text" && value.value.startsWith("\n");
  if (output.gapStart >= 0) {
    if (!newline) {
      appendInlineGap(output, context, output.gapStart, output.gapEnd);
    }
    else {
      output.gapStart = -1;
      output.gapEnd = -1;
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
  output: InlineOutput,
  context: InlineBuildContext,
): boolean {
  const kind = inlineTokenKind(context.tokens, tokenIndex);
  const handle = context.tokenHandlers[kind];
  if (!handle) {
    throw new Error(`Unexpected inline token kind ${kind}`);
  }
  const value = handle(tokenIndex, sourceSpan, context, output.target);
  if (typeof value === "boolean") {
    return value;
  }
  if (!value) {
    return false;
  }
  appendInline(output, context, value);
  return true;
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
  context: InlineBuildContext,
  target: SpannedNode<PhrasingContent>[],
  cursor?: number,
  closeKind?: number,
): number {
  const output: InlineOutput = { cursor, gapEnd: -1, gapStart: -1, target };
  let index = startToken;
  while (index < endToken) {
    const kind = inlineTokenKind(context.tokens, index);
    if (kind === closeKind) {
      break;
    }
    const childOffset = inlineTokenStart(context.tokens, index);
    if (output.cursor !== void 0 && childOffset > output.cursor) {
      output.gapStart = output.cursor;
      output.gapEnd = childOffset;
    }
    const next = buildInlineSemantic(index, endToken, output, context);
    const childEnd = inlineTokenEnd(context.tokens, next === void 0 ? index : next - 1);
    const childEmitted = next === void 0
      ? appendInlineLeaf(
        index,
        context.view.mapSpan(childOffset, childEnd),
        output,
        context,
      )
      : true;
    index = next ?? index + 1;
    if (!childEmitted) {
      continue;
    }
    output.cursor = childEnd;
  }
  if (
    closeKind !== void 0 &&
    index < endToken &&
    output.cursor !== void 0
  ) {
    const contentEnd = inlineTokenStart(context.tokens, index);
    if (contentEnd > output.cursor) {
      appendInlineGap(output, context, output.cursor, contentEnd);
    }
  }
  return index;
}

function buildInlineSemantic(
  openToken: number,
  endToken: number,
  output: InlineOutput,
  context: InlineBuildContext,
): number | undefined {
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
      closeToken = appendInlineRange(
        next,
        endToken,
        context,
        children,
        contentStart,
        container.closeKind,
      );
      if (
        closeToken >= endToken ||
        inlineTokenKind(context.tokens, closeToken) !== container.closeKind
      ) {
        throw new Error(`Resolved inline stream did not close token kind ${kind}`);
      }
      next = closeToken + 1;
    }
    appendInline(
      output,
      context,
      container.build(
        openToken,
        closeToken,
        context.view.mapSpan(
          inlineTokenStart(context.tokens, openToken),
          inlineTokenEnd(context.tokens, closeToken),
        ),
        children,
        context,
      ),
    );
    return next;
  }

  const pair = context.schema.pairByOpenKind[kind];
  if (!pair) {
    return;
  }
  const contentStart = inlineTokenEnd(context.tokens, openToken);
  const children: SpannedNode<PhrasingContent>[] = [];
  const closeToken = appendInlineRange(
    openToken + 1,
    endToken,
    context,
    children,
    contentStart,
    pair.closeKind,
  );
  if (
    closeToken >= endToken ||
    inlineTokenKind(context.tokens, closeToken) !== pair.closeKind
  ) {
    throw new Error(`Resolved inline stream did not close token kind ${kind}`);
  }
  appendInline(
    output,
    context,
    pair.build(
      openToken,
      closeToken,
      context.view.mapSpan(
        inlineTokenStart(context.tokens, openToken),
        inlineTokenEnd(context.tokens, closeToken),
      ),
      children,
      context,
    ),
  );
  return closeToken + 1;
}

export function buildInlineChildren(
  tokenStart: number,
  context: BlockBuildContext,
  allowEmpty = false,
): SpannedNode<PhrasingContent>[] {
  const region = context.inline.take(tokenStart);
  if (!region) {
    const rule = context.structure.ruleNameOf(tokenStart);
    if (allowEmpty) {
      return [];
    }
    throw new Error(`Expected ${rule} syntax to contain inline content`);
  }
  const inlineContext: InlineBuildContext = {
    blockRule: region.rule,
    decodeText: context.profile.decodeText,
    schema: context.profile.schema,
    source: context.source,
    tokenHandlers: context.profile.tokenHandlers,
    tokens: region.tokens,
    view: region.view,
  };
  const result: SpannedNode<PhrasingContent>[] = [];
  appendInlineRange(
    0,
    inlineTokenCount(region.tokens),
    inlineContext,
    result,
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
