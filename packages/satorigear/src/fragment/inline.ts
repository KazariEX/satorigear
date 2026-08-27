import type { PhrasingContent, Text } from "mdast";
import { Character } from "../constants/character.ts";
import { InlineKind } from "../constants/inline.ts";
import {
  inlineTokenCount,
  inlineTokenData,
  inlineTokenEnd,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
} from "../inline/tokens.ts";
import type { BlockRule } from "../constants/block.ts";
import type { InlineProfile } from "../inline/profile.ts";
import type { SourceSpan, SourceView } from "../source-view.ts";
import type { BlockBuildContext } from "./block.ts";
import type { SpannedNode } from "./node.ts";

export interface InlineBuildContext {
  blockRule: BlockRule;
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
  // Cache the last child when it is text so the hot append path does not retrieve
  // heterogeneous node shapes through `.at(-1)` and force the optimized path to exit.
  lastText: SpannedNode<Text> | undefined;
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

function lineEndingStart(source: string, lineStart: number): number {
  return source.charCodeAt(lineStart - 1) === Character.LineFeed &&
    source.charCodeAt(lineStart - 2) === Character.CarriageReturn
    ? lineStart - 2
    : lineStart - 1;
}

function countTrailingSpaces(value: string): number {
  let offset = value.length;
  while (offset > 0) {
    const code = value.charCodeAt(offset - 1);
    if (code !== Character.Space && code !== Character.CharacterTabulation) {
      break;
    }
    offset--;
  }
  return value.length - offset;
}

function appendText(output: InlineOutput, value: string, span: SourceSpan): void {
  const previousText = output.lastText;
  const mergeForward = previousText !== void 0 && !("attributes" in previousText);
  if (output.trailingSpaces >= 0) {
    const trailingSpaces = countTrailingSpaces(value);
    output.trailingSpaces = (
      trailingSpaces === value.length && mergeForward
        ? output.trailingSpaces + trailingSpaces
        : trailingSpaces
    );
  }
  if (mergeForward) {
    previousText.value += value;
    previousText.position.end = span.end;
  }
  else {
    output.children.push(
      output.lastText = { type: "text", value, position: span },
    );
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
    output.lastText = void 0;
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
  // Most tokens only flush the preceding source gap and append their node.
  if (!syntaxNewline) {
    if (output.gapStart >= 0) {
      const gapStart = output.gapStart;
      output.gapStart = -1;
      if (output.gapEnd > gapStart) {
        appendGap(output, context, gapStart, output.gapEnd);
      }
    }
    appendChild(output, value);
    return;
  }

  // Syntax newlines additionally trim line suffixes and repair mapped boundaries.
  const viewLineStart = inlineTokenData(context.tokens, tokenIndex);
  const viewLineEndingStart = lineEndingStart(context.view.text, viewLineStart);
  if (output.gapStart >= 0) {
    const gapStart = output.gapStart;
    output.gapStart = -1;
    if (viewLineEndingStart > gapStart) {
      appendGap(output, context, gapStart, viewLineEndingStart);
    }
  }
  // Markdown syntax newlines point past stripped container prefixes,
  // while mdast spans include the physical line ending.
  const previous = output.children.at(-1);
  if (previous?.type === "break") {
    // At a stripped container boundary, the left side maps before the prefix while
    // the right side maps after it. A hard break must span to the former.
    previous.position.end = context.view.mapPoint(viewLineStart - 1) + 1;
    return;
  }
  value.position.start = context.view.mapPoint(viewLineEndingStart);
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
  appendChild(output, value);
}

// Resolution has already made semantic pairs unambiguous, so projection can consume that stream
// directly instead of copying it into a second syntax arena.
function appendRange(
  startToken: number,
  endToken: number,
  profile: InlineProfile,
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
    const semanticCloseKind = profile.syntaxByKind[syntaxOffset];
    const build = profile.buildByKind[kind]!;
    const childStart = inlineTokenStart(context.tokens, index);
    if (childStart > output.cursor) {
      output.gapStart = output.cursor;
      output.gapEnd = childStart;
    }
    if (semanticCloseKind !== void 0) {
      index = appendSemantic(
        index,
        endToken,
        profile,
        context,
        output,
        build as InlineNodeBuilder,
        semanticCloseKind,
        profile.syntaxByKind[syntaxOffset + 1],
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
      // Decorators may mutate the exposed child list, so refresh the cached projection.
      const previous = output.children.at(-1);
      output.lastText = previous?.type === "text" ? previous : void 0;
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
  profile: InlineProfile,
  context: InlineBuildContext,
  output: InlineOutput,
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
      lastText: void 0,
      trailingSpaces: output.trailingSpaces < 0 ? -1 : 0,
    };
    closeToken = appendRange(
      next,
      endToken,
      profile,
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
    lastText: void 0,
    trailingSpaces: tokens.length && (view.text.includes("\n") || view.text.includes("\r")) ? 0 : -1,
  };
  appendRange(
    0,
    inlineTokenCount(tokens),
    context.profile,
    inlineContext,
    result,
  );
  const last = result.lastText;
  if (last) {
    const removed = result.trailingSpaces < 0
      ? countTrailingSpaces(last.value)
      : result.trailingSpaces;
    if (removed > 0) {
      last.value = last.value.slice(0, -removed);
      last.position.end -= removed;
    }
    if (!last.value) {
      result.children.pop();
    }
  }
  return result;
}
