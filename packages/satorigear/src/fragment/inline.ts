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
import type { BlockRule } from "../constants/block.ts";
import type { SourceSpan, SourceView } from "../source-view.ts";
import type { BlockBuildContext } from "./block.ts";

export interface InlineBuildContext {
  blockRule: BlockRule;
  buildByKind: readonly (InlineBuilder | undefined)[];
  syntaxByKind: readonly number[];
  tokens: InlineTokenStream;
  view: SourceView;
}

export interface InlineFragment {
  children: SpannedNode<PhrasingContent>[];
}

interface InlineOutput extends InlineFragment {
  // The cursor bounds source text that remains implicit between semantic tokens.
  cursor: number;
  gapEnd: number;
  // A negative start invalidates the pending gap and its end.
  gapStart: number;
  // -1 defers counting trailing spaces/tabs to one final scan; otherwise this is the exact count.
  trailingSpaces: number;
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
  target: InlineFragment,
) => boolean;

type InlineTokenHandler = InlineLeafBuilder | InlineTokenDecorator;

export type InlineBuilder = InlineNodeBuilder | InlineTokenHandler;

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

function countTrailingSpaces(value: string): number {
  let offset = value.length;
  while (offset > 0 && (value[offset - 1] === " " || value[offset - 1] === "\t")) {
    offset--;
  }
  return value.length - offset;
}

function appendText(output: InlineOutput, value: string, span: SourceSpan): void {
  if (!value) {
    return;
  }
  const previous = output.children.at(-1);
  if (output.trailingSpaces >= 0) {
    const trailingSpaces = countTrailingSpaces(value);
    output.trailingSpaces = (
      trailingSpaces === value.length &&
      previous?.type === "text" &&
      !("attributes" in previous)
    )
      ? output.trailingSpaces + trailingSpaces
      : trailingSpaces;
  }
  if (previous?.type === "text" && !("attributes" in previous)) {
    previous.value += value;
    extendSpan(previous, span.end);
  }
  else {
    output.children.push({
      type: "text",
      value,
      position: span,
    });
  }
}

function appendChild(
  output: InlineOutput,
  value: SpannedNode<PhrasingContent>,
): void {
  if (value.type === "text") {
    appendText(output, value.value, value.position);
  }
  else {
    output.children.push(value);
    if (output.trailingSpaces > 0) {
      output.trailingSpaces = 0;
    }
  }
}

function appendGap(
  output: InlineOutput,
  context: InlineBuildContext,
  start: number,
  end: number,
): void {
  output.gapStart = -1;
  appendText(
    output,
    context.view.text.slice(start, end),
    context.view.mapSpan(start, end),
  );
}

function appendToken(
  output: InlineOutput,
  context: InlineBuildContext,
  tokenIndex: number,
  value: SpannedNode<PhrasingContent>,
): void {
  const newline = value.type === "text" && value.value.startsWith("\n");
  if (output.gapStart >= 0) {
    const gapStart = output.gapStart;
    const gapEnd = newline
      ? lineEndingStart(context.view.text, output.gapEnd)
      : output.gapEnd;
    if (gapEnd > gapStart) {
      appendGap(output, context, gapStart, gapEnd);
    }
    else {
      output.gapStart = -1;
    }
  }
  if (newline) {
    const viewStart = inlineTokenStart(context.tokens, tokenIndex);
    // Markdown syntax newlines point past stripped container prefixes,
    // while mdast spans include the physical line ending.
    const previous = output.children.at(-1);
    if (previous?.type === "break") {
      const viewLineStart = lineStart(context.view.text, viewStart);
      // At a stripped container boundary, the left side maps before the prefix while
      // the right side maps after it. A hard break must span to the former.
      extendSpan(
        previous,
        viewLineStart === 0
          ? context.view.mapPoint(0)
          : context.view.mapPoint(viewLineStart - 1) + 1,
      );
      return;
    }
    value.position.start = context.view.mapPoint(lineEndingStart(context.view.text, viewStart));
    if (previous?.type === "text") {
      if (output.trailingSpaces < 0) {
        previous.value = previous.value.slice(
          0,
          previous.value.length - countTrailingSpaces(previous.value),
        );
      }
      else if (output.trailingSpaces > 0) {
        previous.value = previous.value.slice(0, -output.trailingSpaces);
        output.trailingSpaces = 0;
      }
    }
  }
  appendChild(output, value);
}

function appendLeaf(
  tokenIndex: number,
  handle: InlineTokenHandler,
  sourceSpan: SourceSpan,
  output: InlineOutput,
  context: InlineBuildContext,
): boolean {
  const value = handle(tokenIndex, sourceSpan, context, output);
  if (typeof value === "boolean") {
    return value;
  }
  if (!value) {
    return false;
  }
  appendToken(output, context, tokenIndex, value);
  return true;
}

// Resolution has already made semantic pairs unambiguous, so projection can consume that stream
// directly instead of copying it into a second syntax arena.
function appendRange(
  startToken: number,
  endToken: number,
  context: InlineBuildContext,
  output: InlineOutput,
  closeKind?: number,
): number {
  let index = startToken;
  while (index < endToken) {
    const kind = inlineTokenKind(context.tokens, index);
    if (kind === closeKind) {
      break;
    }
    const syntaxOffset = kind * 2;
    const semanticCloseKind = context.syntaxByKind[syntaxOffset];
    const build = context.buildByKind[kind];
    if (!build) {
      throw new Error(`Unexpected inline token kind ${kind}`);
    }
    const childStart = inlineTokenStart(context.tokens, index);
    if (childStart > output.cursor) {
      output.gapStart = output.cursor;
      output.gapEnd = childStart;
    }
    const next = semanticCloseKind === void 0
      ? void 0
      : appendSemantic(
        index,
        kind,
        endToken,
        output,
        context,
        build as InlineNodeBuilder,
        semanticCloseKind,
        context.syntaxByKind[syntaxOffset + 1],
      );
    const childEnd = inlineTokenEnd(context.tokens, next === void 0 ? index : next - 1);
    const childEmitted = next === void 0
      ? appendLeaf(
        index,
        build as InlineTokenHandler,
        context.view.mapSpan(childStart, childEnd),
        output,
        context,
      )
      : true;
    if (childEmitted) {
      output.cursor = childEnd;
    }
    index = next ?? index + 1;
  }
  if (closeKind !== void 0 && index < endToken) {
    const contentEnd = inlineTokenStart(context.tokens, index);
    if (contentEnd > output.cursor) {
      appendGap(output, context, output.cursor, contentEnd);
    }
  }
  else if (
    closeKind === void 0 &&
    context.view.text.length > output.cursor
  ) {
    appendGap(output, context, output.cursor, context.view.text.length);
  }
  return index;
}

function appendSemantic(
  openToken: number,
  kind: number,
  endToken: number,
  output: InlineOutput,
  context: InlineBuildContext,
  build: InlineNodeBuilder,
  closeKind: number,
  contentOpenKind: number,
): number {
  let closeToken = openToken;
  let next = openToken + 1;
  const children: SpannedNode<PhrasingContent>[] = [];
  if (
    contentOpenKind === 0 ||
    next < endToken && inlineTokenKind(context.tokens, next) === contentOpenKind
  ) {
    const childOutput: InlineOutput = {
      children,
      cursor: inlineTokenEnd(
        context.tokens,
        contentOpenKind === 0 ? openToken : next++,
      ),
      gapEnd: -1,
      gapStart: -1,
      trailingSpaces: output.trailingSpaces < 0 ? -1 : 0,
    };
    closeToken = appendRange(
      next,
      endToken,
      context,
      childOutput,
      closeKind,
    );
    if (
      closeToken >= endToken ||
      inlineTokenKind(context.tokens, closeToken) !== closeKind
    ) {
      throw new Error(`Resolved inline stream did not close token kind ${kind}`);
    }
  }
  const value = build(
    openToken,
    closeToken,
    context.view.mapSpan(
      inlineTokenStart(context.tokens, openToken),
      inlineTokenEnd(context.tokens, closeToken),
    ),
    children,
    context,
  );
  appendToken(output, context, openToken, value);
  return closeToken + 1;
}

export function buildInlineFragment(
  tokenStart: number,
  blockRule: BlockRule,
  context: BlockBuildContext,
): InlineFragment {
  const region = context.cursor.take(tokenStart);
  if (!region) {
    return {
      children: [],
    };
  }
  const { tokens, view } = region;
  const inlineContext: InlineBuildContext = {
    blockRule,
    buildByKind: context.profile.buildByKind,
    syntaxByKind: context.profile.syntaxByKind,
    tokens,
    view,
  };
  const result: InlineOutput = {
    children: [],
    cursor: 0,
    gapEnd: -1,
    gapStart: -1,
    trailingSpaces: tokens.length && (view.text.includes("\n") || view.text.includes("\r")) ? 0 : -1,
  };
  appendRange(
    0,
    inlineTokenCount(tokens),
    inlineContext,
    result,
  );
  const last = result.children.at(-1);
  if (last?.type === "text") {
    const removed = result.trailingSpaces < 0
      ? countTrailingSpaces(last.value)
      : result.trailingSpaces;
    last.value = last.value.slice(0, last.value.length - removed);
    last.position.end -= removed;
    if (!last.value) {
      result.children.pop();
    }
  }
  return result;
}
