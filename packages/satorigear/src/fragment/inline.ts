import type { PhrasingContent, Text } from "mdast";
import { trimLineWhitespaceEnd } from "../block/lines.ts";
import { BlockKind } from "../constants/block.ts";
import { InlineKind, InlineRole } from "../constants/inline.ts";
import {
  inlineTokenCount,
  inlineTokenData,
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
  pendingSpaces: number;
}

function createInlineOutput(children: PhrasingContent[], cursor: number): InlineOutput {
  return {
    children,
    cursor,
    pendingText: void 0,
    pendingEnd: 0,
    pendingSpaces: 0,
  };
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

function createLiteralChildren(context: InlineBuildContext, start: number, end: number): PhrasingContent[] {
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

function appendText(
  output: InlineOutput,
  value: string,
  start: number,
  end: number,
  context: InlineBuildContext,
  literal: boolean,
): void {
  // Decoded runs are semantic text; whitespace they produce is not a source suffix.
  const trailingSpaces = literal
    ? value.length - trimLineWhitespaceEnd(value, 0, value.length)
    : 0;
  if (output.pendingText !== void 0 && !("attributes" in output.pendingText)) {
    output.pendingText.value += value;
    output.pendingSpaces = trailingSpaces === value.length
      ? trailingSpaces + output.pendingSpaces
      : trailingSpaces;
  }
  else {
    const startLocation = context.locator.locationAt(context.view.mapOffset(start));
    const text: Text = {
      type: "text",
      value,
      position: { start: startLocation, end: startLocation },
    };
    output.children.push(text);
    output.pendingText = text;
    output.pendingSpaces = trailingSpaces;
  }
  output.pendingEnd = end;
}

function finishText(output: InlineOutput, context: InlineBuildContext): void {
  const text = output.pendingText;
  if (text) {
    text.position!.end = context.locator.locationAt(context.view.mapEnd(output.pendingEnd));
  }
}

function trimTrailingText(output: InlineOutput): void {
  const removed = output.pendingText ? output.pendingSpaces : 0;
  if (removed > 0) {
    output.pendingText!.value = output.pendingText!.value.slice(0, -removed);
    output.pendingEnd -= removed;
    output.pendingSpaces = 0;
  }
}

function appendGap(
  output: InlineOutput,
  context: InlineBuildContext,
  start: number,
  end: number,
): void {
  const value = context.view.text.slice(start, end);
  appendText(output, value, start, end, context, true);
}

function appendLeaf(
  output: InlineOutput,
  context: InlineBuildContext,
  token: number,
  start: number,
  end: number,
  build: InlineLeafBuilder,
): void {
  if (start > output.cursor) {
    appendGap(output, context, output.cursor, start);
  }
  const sourceStart = context.view.mapOffset(start);
  const sourceEnd = start === end ? sourceStart : context.view.mapEnd(end);
  finishText(output, context);
  output.children.push(build(
    token,
    context.locator.positionAt(sourceStart, sourceEnd),
    context,
  ));
  output.pendingText = void 0;
}

// Resolution has already made semantic pairs unambiguous, so projection can consume that stream
// directly instead of copying it into a second syntax arena.
function appendRange(
  profile: InlineProfile,
  context: InlineBuildContext,
  output: InlineOutput,
  startToken: number,
  endToken: number,
): number {
  let index = startToken;
  while (index < endToken) {
    const kind = inlineTokenKind(context.tokens, index);
    // Newline has fixed semantic text, so it does not enter profile builder dispatch.
    if (kind === InlineKind.Newline) {
      const endingStart = inlineTokenStart(context.tokens, index);
      const lineStart = inlineTokenData(context.tokens, index);
      const contentStart = inlineTokenEnd(context.tokens, index);
      if (endingStart > output.cursor) {
        appendGap(output, context, output.cursor, endingStart);
      }
      // Markdown syntax newlines point past stripped container prefixes,
      // while mdast spans include the physical line ending.
      const previous = output.pendingText === void 0 ? output.children.at(-1) : void 0;
      if (previous?.type === "break") {
        // At a stripped container boundary, the left side maps before the prefix while
        // the right side maps after it. A hard break must span to the former.
        previous.position!.end = context.locator.locationAt(
          context.view.mapOffset(lineStart - 1) + 1,
        );
      }
      else {
        trimTrailingText(output);
        appendText(
          output,
          "\n",
          endingStart,
          contentStart,
          context,
          false,
        );
      }
      output.cursor = contentStart;
      index++;
      continue;
    }
    const build = profile.builders[kind]!;
    const childStart = inlineTokenStart(context.tokens, index);
    if (kind < InlineRole.Pair) {
      const childEnd = inlineTokenEnd(context.tokens, index);
      if (kind < InlineRole.Leaf) {
        if (childStart > output.cursor) {
          appendGap(output, context, output.cursor, childStart);
        }
        appendText(
          output,
          (build as InlineTextBuilder)(index, context),
          childStart,
          childEnd,
          context,
          kind === InlineKind.LiteralText,
        );
      }
      else {
        appendLeaf(
          output,
          context,
          index,
          childStart,
          childEnd,
          build as InlineLeafBuilder,
        );
      }
      output.cursor = childEnd;
      index++;
      continue;
    }
    if (kind < InlineRole.Decorate) {
      // Resolved pairs are properly nested; every close ends the current range.
      if (kind & 1) {
        break;
      }
      if (childStart > output.cursor) {
        appendGap(output, context, output.cursor, childStart);
      }
      finishText(output, context);
      index = appendPair(
        profile,
        context,
        output,
        index,
        endToken,
        build as InlinePairBuilder,
      );
      continue;
    }
    const childEnd = inlineTokenEnd(context.tokens, index);
    finishText(output, context);
    const sourceStart = context.view.mapOffset(childStart);
    const sourceSpan = {
      start: sourceStart,
      end: childStart === childEnd ? sourceStart : context.view.mapEnd(childEnd),
    };
    if ((build as InlineTokenDecorator)(index, sourceSpan, context, output)) {
      // Applied decorators may mutate the exposed child list, so refresh the cached projection.
      const previous = output.children.at(-1);
      output.pendingText = previous?.type === "text" ? previous as Text : void 0;
      output.pendingEnd = childEnd;
      output.cursor = childEnd;
    }
    index++;
  }
  const contentEnd = index < endToken ? inlineTokenStart(context.tokens, index) : context.view.text.length;
  if (contentEnd > output.cursor) {
    appendGap(output, context, output.cursor, contentEnd);
  }
  // Every range closes its own projection; only a fragment boundary owns final trimming.
  if (startToken === 0) {
    trimTrailingText(output);
    if (output.pendingText && !output.pendingText.value) {
      output.children.pop();
    }
  }
  finishText(output, context);
  return index;
}

function appendPair(
  profile: InlineProfile,
  context: InlineBuildContext,
  output: InlineOutput,
  openToken: number,
  endToken: number,
  build: InlinePairBuilder,
): number {
  const childStart = inlineTokenStart(context.tokens, openToken);
  const positionStart = context.locator.locationAt(context.view.mapOffset(childStart));
  const nextToken = openToken + 1;
  const nextKind = inlineTokenKind(context.tokens, nextToken);
  let children: PhrasingContent[];
  let closeToken: number;
  // Adjacent pair boundaries contain only an implicit literal source range.
  if (nextKind >= InlineRole.Pair && nextKind < InlineRole.Decorate && nextKind & 1) {
    children = createLiteralChildren(
      context,
      inlineTokenEnd(context.tokens, openToken),
      inlineTokenStart(context.tokens, nextToken),
    );
    closeToken = nextToken;
  }
  else {
    const output = createInlineOutput(children = [], inlineTokenEnd(context.tokens, openToken));
    closeToken = appendRange(profile, context, output, nextToken, endToken);
  }
  const childEnd = inlineTokenEnd(context.tokens, closeToken);
  const value = build(
    openToken,
    closeToken,
    {
      start: positionStart,
      end: context.locator.locationAt(context.view.mapEnd(childEnd)),
    },
    children,
    context,
  );
  output.children.push(value);
  output.pendingText = void 0;
  output.cursor = childEnd;
  return closeToken + 1;
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
    if (nodeLength === 1 || blockTokens.kind(tokenStart + 1) !== BlockKind.InlineChunk) {
      return { children: [] };
    }

    const previousView = context.inlineContext?.view;
    view = (
      previousView?.reset(context.source, blockTokens, tokenStart, nodeLength),
      previousView
    ) ?? new SourceView(context.source, blockTokens, tokenStart, nodeLength);

    tokens = context.profile.tokenize(view.text);
    if (tokens.length) {
      tokens = context.profile.resolve(view.text, tokens, blockTokens);
    }
  }

  const inlineContext = context.inlineContext ??= {
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
      children: createLiteralChildren(inlineContext, 0, end),
    };
  }

  const output = createInlineOutput([], 0);
  appendRange(context.profile, inlineContext, output, 0, inlineTokenCount(tokens));
  return output;
}
