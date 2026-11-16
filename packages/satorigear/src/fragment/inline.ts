import type { PhrasingContent, Text } from "mdast";
import { trimLineWhitespaceEnd } from "../block/lines.ts";
import { BlockKind } from "../constants/block.ts";
import { InlineKind, InlineRole } from "../constants/inline.ts";
import {
  inlineTokenCount,
  inlineTokenEnd,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
} from "../inline/tokens.ts";
import {
  type SourceLocator,
  type SourcePosition,
  type SourceSpan,
  SourceView,
} from "../source-view.ts";
import type { InlineProfile } from "../inline/profile.ts";
import type { BlockBuildContext } from "./block.ts";

type InlineNonText = Exclude<PhrasingContent, Text>;

export interface InlineBuildContext {
  builders: InlineProfile["builders"];
  // Recursive builders publish the next token here; a child range stops at its closer.
  tokenIndex: number;
  locator: SourceLocator;
  // Table splitting preserves `\|`; inline code removes that structural escape.
  tableCell: boolean;
  tokens: InlineTokenStream;
  view: SourceView;
}

export interface InlineFragment {
  children: PhrasingContent[];
}

interface InlineOutput extends InlineFragment {
  // The cursor bounds source text that remains implicit between semantic tokens.
  cursor: number;
  // The text child is published immediately; only its source end remains pending.
  pendingText: Text | undefined;
  // Keep the end in view coordinates until the merged text is complete.
  pendingEnd: number;
  // Keep only the consecutive literal suffix; decoded whitespace is semantic text.
  pendingLiteral: string;
}

export type InlineLeafBuilder = (
  tokenIndex: number,
  position: SourcePosition,
  context: InlineBuildContext,
) => InlineNonText;

export type InlineTextBuilder = (
  tokenIndex: number,
  context: InlineBuildContext,
) => string;

export type InlinePairBuilder = (
  openToken: number,
  closeToken: number,
  position: SourcePosition,
  children: PhrasingContent[],
  context: InlineBuildContext,
) => InlineNonText;

export type InlineTokenDecorator = (
  tokenIndex: number,
  sourceSpan: SourceSpan,
  context: InlineBuildContext,
  target: InlineFragment,
) => boolean;

export type InlineBuilder =
  | InlineLeafBuilder
  | InlinePairBuilder
  | InlineTextBuilder
  | InlineTokenDecorator;

function appendText(
  context: InlineBuildContext,
  output: InlineOutput,
  value: string,
  start: number,
  end: number,
  literal: boolean,
): void {
  if (output.pendingText === void 0 || "attributes" in output.pendingText) {
    const startLocation = context.locator.locationAt(context.view.mapOffset(start));
    const text: Text = {
      type: "text",
      value,
      position: { start: startLocation, end: startLocation },
    };
    output.children.push(text);
    output.pendingText = text;
    output.pendingLiteral = literal ? value : "";
  }
  else {
    output.pendingText.value += value;
    output.pendingLiteral = literal ? output.pendingLiteral + value : "";
  }
  output.pendingEnd = end;
}

function finishText(context: InlineBuildContext, output: InlineOutput): void {
  if (output.pendingText) {
    output.pendingText.position!.end = context.locator.locationAt(
      context.view.mapEnd(output.pendingEnd),
    );
  }
}

function trimTrailingText(context: InlineBuildContext, output: InlineOutput): void {
  if (output.pendingText) {
    const literal = output.pendingLiteral;
    const removed = literal.length - trimLineWhitespaceEnd(literal, 0, literal.length);
    if (removed > 0) {
      // Removing an all-whitespace pending gap must also move its source start.
      if (removed === output.pendingText.value.length) {
        output.pendingText.position!.start = context.locator.locationAt(
          context.view.mapOffset(output.pendingEnd),
        );
      }
      output.pendingText.value = output.pendingText.value.slice(0, -removed);
      output.pendingEnd -= removed;
      output.pendingLiteral = "";
    }
  }
}

function appendGap(
  context: InlineBuildContext,
  output: InlineOutput,
  start: number,
  end: number,
): void {
  const value = context.view.text.slice(start, end);
  appendText(context, output, value, start, end, true);
}

// Resolution has already made semantic pairs unambiguous, so projection can consume that stream
// directly instead of copying it into a second syntax arena.
function appendRange(context: InlineBuildContext, output: InlineOutput, trimEnd: boolean): void {
  let index = context.tokenIndex;
  const end = inlineTokenCount(context.tokens);
  while (index < end) {
    const kind = inlineTokenKind(context.tokens, index);
    // Newline has fixed semantic text, so it does not enter profile builder dispatch.
    if (kind === InlineKind.Newline) {
      const endingStart = inlineTokenStart(context.tokens, index);
      const contentStart = inlineTokenEnd(context.tokens, index);
      if (endingStart > output.cursor) {
        appendGap(context, output, output.cursor, endingStart);
      }
      trimTrailingText(context, output);
      appendText(context, output, "\n", endingStart, contentStart, false);
      output.cursor = contentStart;
      index++;
      continue;
    }
    const childStart = inlineTokenStart(context.tokens, index);
    if (kind < InlineRole.Leaf) {
      const childEnd = inlineTokenEnd(context.tokens, index);
      if (childStart > output.cursor) {
        appendGap(context, output, output.cursor, childStart);
      }
      const build = context.builders[kind] as InlineTextBuilder;
      appendText(context, output, build(index, context), childStart, childEnd, kind === InlineKind.LiteralText);
      output.cursor = childEnd;
      index++;
      continue;
    }
    if (kind < InlineRole.Decorate) {
      if (kind >= InlineRole.Pair && kind & 1) {
        break;
      }
      if (childStart > output.cursor) {
        appendGap(context, output, output.cursor, childStart);
      }
      finishText(context, output);
      output.children.push(buildNode(context, index, kind));
      output.pendingText = void 0;
      index = context.tokenIndex;
      output.cursor = inlineTokenEnd(context.tokens, index - 1);
      continue;
    }
    const childEnd = inlineTokenEnd(context.tokens, index);
    finishText(context, output);
    const sourceStart = context.view.mapOffset(childStart);
    const sourceSpan = {
      start: sourceStart,
      end: childStart === childEnd ? sourceStart : context.view.mapEnd(childEnd),
    };
    const decorate = context.builders[kind] as InlineTokenDecorator;
    if (decorate(index, sourceSpan, context, output)) {
      // Applied decorators may mutate the exposed child list, so refresh the cached projection.
      const previous = output.children.at(-1);
      output.pendingText = previous?.type === "text" ? previous as Text : void 0;
      output.pendingEnd = childEnd;
      output.cursor = childEnd;
    }
    index++;
  }
  const contentEnd = index < end ? inlineTokenStart(context.tokens, index) : context.view.text.length;
  if (contentEnd > output.cursor) {
    appendGap(context, output, output.cursor, contentEnd);
  }
  // Every range closes its own projection; only a fragment boundary owns final trimming.
  if (trimEnd) {
    trimTrailingText(context, output);
    if (output.pendingText && !output.pendingText.value) {
      output.children.pop();
    }
  }
  finishText(context, output);
  context.tokenIndex = index;
}

function buildLiteral(context: InlineBuildContext, start: number, end: number): PhrasingContent[] {
  return start >= end
    ? []
    : [{
      type: "text",
      value: context.view.text.slice(start, end),
      position: context.locator.positionAt(
        context.view.mapOffset(start),
        context.view.mapEnd(end),
      ),
    }];
}

function buildNode(context: InlineBuildContext, token: number, kind: number): InlineNonText {
  const startOffset = inlineTokenStart(context.tokens, token);
  const sourceStart = context.view.mapOffset(startOffset);
  const start = context.locator.locationAt(sourceStart);
  let close = token;
  let children: PhrasingContent[] | undefined;
  if (kind >= InlineRole.Pair) {
    const next = token + 1;
    const contentStart = inlineTokenEnd(context.tokens, token);
    if (inlineTokenKind(context.tokens, next) === kind + 1) {
      close = next;
      children = buildLiteral(context, contentStart, inlineTokenStart(context.tokens, close));
    }
    else {
      context.tokenIndex = next;
      children = buildFragment(context, contentStart, kind + 1).children;
      close = context.tokenIndex;
    }
  }
  context.tokenIndex = close + 1;
  const endOffset = inlineTokenEnd(context.tokens, close);
  const position = {
    start,
    end: context.locator.locationAt(
      startOffset === endOffset ? sourceStart : context.view.mapEnd(endOffset),
    ),
  };
  const build = context.builders[kind];
  return children
    ? (build as InlinePairBuilder)(token, close, position, children, context)
    : (build as InlineLeafBuilder)(token, position, context);
}

function buildFragment(context: InlineBuildContext, cursor: number, closeKind: number): InlineFragment {
  const trimEnd = closeKind === InlineKind.None;
  const token = context.tokenIndex;
  const kind = inlineTokenKind(context.tokens, token);
  let children: PhrasingContent[] | undefined;
  if (
    kind >= InlineRole.Leaf &&
    kind < InlineRole.Decorate &&
    inlineTokenStart(context.tokens, token) === cursor
  ) {
    const node = buildNode(context, token, kind);
    const atEnd = context.tokenIndex === inlineTokenCount(context.tokens);
    cursor = inlineTokenEnd(context.tokens, context.tokenIndex - 1);
    if (atEnd || inlineTokenKind(context.tokens, context.tokenIndex) === closeKind) {
      const end = atEnd ? context.view.text.length : inlineTokenStart(context.tokens, context.tokenIndex);
      if (
        cursor === end ||
        trimEnd && cursor === trimLineWhitespaceEnd(context.view.text, cursor, end)
      ) {
        return { children: [node] };
      }
    }
    children = [node];
  }
  const output = {
    children: children ?? [],
    cursor,
    pendingText: void 0,
    pendingEnd: 0,
    pendingLiteral: "",
  };
  appendRange(context, output, trimEnd);
  return output;
}

export function buildInlineFragment(
  tokenStart: number,
  tableCell: boolean,
  context: BlockBuildContext,
): InlineFragment {
  let tokens: InlineTokenStream;
  let view: SourceView;

  if (context.cursor) {
    const region = context.cursor.take(tokenStart);
    if (!region) {
      return { children: [] };
    }
    tokens = region.tokens;
    view = region.view;
  }
  else {
    const blockTokens = context.structure.tokens;
    const nodeLength = blockTokens.nodeLength(tokenStart);
    if (nodeLength <= 1 || blockTokens.kind(tokenStart + 1) !== BlockKind.InlineChunk) {
      return { children: [] };
    }

    const previousView = context.inlineContext?.view;
    view = (
      previousView?.reset(context.source, blockTokens, tokenStart, nodeLength),
      previousView
    ) ?? new SourceView(context.source, blockTokens, tokenStart, nodeLength);

    tokens = context.profile.tokenize(view.text, view.withBoundaryBreak);
    if (tokens.length) {
      tokens = context.profile.resolve(view.text, tokens, blockTokens);
    }
  }

  const inlineContext = context.inlineContext ??= {
    builders: context.profile.builders,
    tokenIndex: 0,
    locator: context.locator,
    tableCell,
    tokens,
    view,
  };
  inlineContext.tableCell = tableCell;
  inlineContext.tokens = tokens;
  inlineContext.view = view;

  if (tokens.length === 0) {
    const end = trimLineWhitespaceEnd(view.text, 0, view.text.length);
    return {
      children: buildLiteral(inlineContext, 0, end),
    };
  }
  inlineContext.tokenIndex = 0;
  return buildFragment(inlineContext, 0, InlineKind.None);
}
