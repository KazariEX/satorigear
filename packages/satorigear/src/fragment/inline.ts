import type { PhrasingContent } from "mdast";
import { Character } from "../constants/character.ts";
import { InlineKind } from "../constants/inline.ts";
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
) => SpannedNode<PhrasingContent>;

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
  const previous = output.children.at(-1);
  if (output.trailingSpaces >= 0) {
    const trailingSpaces = countTrailingSpaces(value);
    output.trailingSpaces = (
      trailingSpaces === value.length && previous?.type === "text" && !("attributes" in previous)
        ? output.trailingSpaces + trailingSpaces
        : trailingSpaces
    );
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
  syntaxNewline: boolean,
): void {
  if (output.gapStart >= 0) {
    const gapStart = output.gapStart;
    output.gapStart = -1;
    const gapEnd = syntaxNewline
      ? lineEndingStart(context.view.text, output.gapEnd)
      : output.gapEnd;
    if (gapEnd > gapStart) {
      appendGap(output, context, gapStart, gapEnd);
    }
  }
  if (syntaxNewline) {
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

// Resolution has already made semantic pairs unambiguous, so projection can consume that stream
// directly instead of copying it into a second syntax arena.
function appendRange(
  startToken: number,
  endToken: number,
  context: InlineBuildContext,
  output: InlineOutput,
  closeKind = InlineKind.None,
): number {
  let index = startToken;
  while (index < endToken) {
    const kind = inlineTokenKind(context.tokens, index);
    if (kind === closeKind) {
      break;
    }
    const syntaxOffset = kind * 2;
    const semanticCloseKind = context.syntaxByKind[syntaxOffset];
    const build = context.buildByKind[kind]!;
    const childStart = inlineTokenStart(context.tokens, index);
    if (childStart > output.cursor) {
      output.gapStart = output.cursor;
      output.gapEnd = childStart;
    }
    if (semanticCloseKind !== void 0) {
      index = appendSemantic(
        index,
        endToken,
        output,
        context,
        build as InlineNodeBuilder,
        semanticCloseKind,
        context.syntaxByKind[syntaxOffset + 1],
      );
      continue;
    }
    const childEnd = inlineTokenEnd(context.tokens, index);
    const value = (build as InlineTokenHandler)(
      index,
      context.view.mapSpan(childStart, childEnd),
      context,
      output,
    );
    if (typeof value === "boolean") {
      if (value) {
        output.cursor = childEnd;
      }
    }
    else {
      appendToken(
        output,
        context,
        index,
        value,
        // Distinguishes lexer-emitted newlines from text that merely decodes to "\n".
        kind === InlineKind.Newline,
      );
      output.cursor = childEnd;
    }
    index++;
  }
  if (index < endToken) {
    const contentEnd = inlineTokenStart(context.tokens, index);
    if (contentEnd > output.cursor) {
      appendGap(output, context, output.cursor, contentEnd);
    }
  }
  else if (closeKind === InlineKind.None && context.view.text.length > output.cursor) {
    appendGap(output, context, output.cursor, context.view.text.length);
  }
  return index;
}

function appendSemantic(
  openToken: number,
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
  }
  const childStart = inlineTokenStart(context.tokens, openToken);
  const childEnd = inlineTokenEnd(context.tokens, closeToken);
  const value = build(
    openToken,
    closeToken,
    context.view.mapSpan(childStart, childEnd),
    children,
    context,
  );
  appendToken(output, context, openToken, value, false);
  output.cursor = childEnd;
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
  const inlineContext = context.inlineContext ??= {
    blockRule,
    buildByKind: context.profile.buildByKind,
    syntaxByKind: context.profile.syntaxByKind,
    tokens,
    view,
  };
  inlineContext.blockRule = blockRule;
  inlineContext.tokens = tokens;
  inlineContext.view = view;
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
