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
import type { SourceLocator, SourcePosition, SourceSpan, SourceView } from "../source-view.ts";
import type { BlockBuildContext } from "./block.ts";

type InlineNonText = Exclude<PhrasingContent, Text>;

export interface InlineBuildContext {
  blockRule: BlockRule;
  locator: SourceLocator;
  tokens: InlineTokenStream;
  view: SourceView;
}

export interface InlineFragment {
  children: PhrasingContent[];
}

interface InlineOutput extends InlineFragment {
  // The cursor bounds source text that remains implicit between semantic tokens.
  cursor: number;
  // Cache the last child when it is text so the hot append path does not retrieve
  // heterogeneous node shapes through `.at(-1)` and force the optimized path to exit.
  lastText: Text | undefined;
  // A pending text run shares its start location until resolving the final end once.
  textEnd: number;
  // Maintain the suffix length while appending so trimming never scans merged text.
  trailingSpaces: number;
}

function createInlineOutput(children: PhrasingContent[], cursor: number): InlineOutput {
  return {
    children,
    cursor,
    lastText: void 0,
    textEnd: -1,
    trailingSpaces: 0,
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

export type InlineNodeBuilder = (
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
  | InlineNodeBuilder
  | InlineTextBuilder
  | InlineTokenDecorator;

function lineEndingStart(source: string, lineStart: number): number {
  return source.charCodeAt(lineStart - 1) === Character.LineFeed &&
    source.charCodeAt(lineStart - 2) === Character.CarriageReturn
    ? lineStart - 2
    : lineStart - 1;
}

function trimTrailingText(output: InlineOutput): number {
  const text = output.lastText;
  const removed = text ? output.trailingSpaces : 0;
  if (removed > 0) {
    text!.value = text!.value.slice(0, -removed);
    output.trailingSpaces = 0;
  }
  return removed;
}

function appendText(
  output: InlineOutput,
  value: string,
  start: number,
  end: number,
  context: InlineBuildContext,
): void {
  const previousText = output.lastText;
  const mergeForward = previousText !== void 0 && !("attributes" in previousText);
  let offset = value.length;
  while (offset > 0) {
    const code = value.charCodeAt(offset - 1);
    if (code !== Character.Space && code !== Character.CharacterTabulation) {
      break;
    }
    offset--;
  }
  const trailingSpaces = value.length - offset;
  output.trailingSpaces = trailingSpaces === value.length && mergeForward
    ? output.trailingSpaces + trailingSpaces
    : trailingSpaces;
  if (mergeForward) {
    previousText!.value += value;
  }
  else {
    const startLocation = context.locator.locationAt(start);
    const text: Text = {
      type: "text",
      value,
      position: { start: startLocation, end: startLocation },
    };
    output.children.push(text);
    output.lastText = text;
  }
  output.textEnd = end;
}

function finishText(output: InlineOutput, context: InlineBuildContext): void {
  const end = output.textEnd;
  if (end >= 0) {
    output.lastText!.position!.end = context.locator.locationAt(end);
    output.textEnd = -1;
  }
}

function appendGap(
  output: InlineOutput,
  context: InlineBuildContext,
  start: number,
  end: number,
): void {
  const value = context.view.text.slice(start, end);
  const sourceSpan = context.view.mapSpan(start, end);
  appendText(output, value, sourceSpan.start, sourceSpan.end, context);
}

function appendToken(
  output: InlineOutput,
  context: InlineBuildContext,
  tokenIndex: number,
  viewStart: number,
  viewEnd: number,
  build: InlineLeafBuilder | InlineTextBuilder,
  textToken: boolean,
  syntaxNewline: boolean,
): void {
  const cursor = output.cursor;
  // Most tokens only flush the preceding source gap and append their node.
  if (!syntaxNewline) {
    if (viewStart > cursor) {
      appendGap(output, context, cursor, viewStart);
    }
  }
  else {
    // Syntax newlines additionally trim line suffixes and repair mapped boundaries.
    const viewLineStart = inlineTokenData(context.tokens, tokenIndex);
    const viewLineEndingStart = lineEndingStart(context.view.text, viewLineStart);
    if (viewStart > cursor) {
      if (viewLineEndingStart > cursor) {
        appendGap(output, context, cursor, viewLineEndingStart);
      }
    }
    // Markdown syntax newlines point past stripped container prefixes,
    // while mdast spans include the physical line ending.
    const previous = output.children.at(-1);
    if (previous?.type === "break") {
      // At a stripped container boundary, the left side maps before the prefix while
      // the right side maps after it. A hard break must span to the former.
      previous.position!.end = context.locator.locationAt(
        context.view.mapPoint(viewLineStart - 1) + 1,
      );
      return;
    }
    viewStart = viewLineEndingStart;
    trimTrailingText(output);
  }
  const sourceSpan = context.view.mapSpan(viewStart, viewEnd);
  if (textToken) {
    appendText(
      output,
      (build as InlineTextBuilder)(tokenIndex, context),
      sourceSpan.start,
      sourceSpan.end,
      context,
    );
  }
  else {
    finishText(output, context);
    output.children.push((build as InlineLeafBuilder)(
      tokenIndex,
      context.locator.positionAt(sourceSpan.start, sourceSpan.end),
      context,
    ));
    output.lastText = void 0;
  }
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
    if (semanticCloseKind !== void 0) {
      if (childStart > output.cursor) {
        appendGap(output, context, output.cursor, childStart);
      }
      finishText(output, context);
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
    if (profile.decorateByKind[kind]) {
      finishText(output, context);
      const sourceSpan = context.view.mapSpan(childStart, childEnd);
      if ((build as InlineTokenDecorator)(index, sourceSpan, context, output)) {
        // Applied decorators may mutate the exposed child list, so refresh the cached projection.
        const previous = output.children.at(-1);
        output.lastText = previous?.type === "text"
          ? previous as Text
          : void 0;
        output.cursor = childEnd;
      }
    }
    else {
      appendToken(
        output,
        context,
        index,
        childStart,
        childEnd,
        build as InlineLeafBuilder | InlineTextBuilder,
        profile.textByKind[kind],
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
  else if (context.view.text.length > output.cursor) {
    appendGap(output, context, output.cursor, context.view.text.length);
  }
  finishText(output, context);
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
  const childStart = inlineTokenStart(context.tokens, openToken);
  const positionStart = context.locator.locationAt(context.view.mapPoint(childStart));
  let closeToken = openToken;
  let next = openToken + 1;
  const children: PhrasingContent[] = [];
  if (
    contentOpenKind === 0 ||
    next < endToken && inlineTokenKind(context.tokens, next) === contentOpenKind
  ) {
    const childOutput = createInlineOutput(
      children,
      inlineTokenEnd(
        context.tokens,
        contentOpenKind === 0 ? openToken : next++,
      ),
    );
    closeToken = appendRange(
      next,
      endToken,
      profile,
      context,
      childOutput,
      closeKind,
    );
  }
  const childEnd = inlineTokenEnd(context.tokens, closeToken);
  const sourceSpan = context.view.mapSpan(childStart, childEnd);
  const value = build(
    openToken,
    closeToken,
    {
      start: positionStart,
      end: context.locator.locationAt(sourceSpan.end),
    },
    children,
    context,
  );
  output.children.push(value);
  output.lastText = void 0;
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
    locator: context.locator,
    tokens,
    view,
  };
  inlineContext.blockRule = blockRule;
  inlineContext.tokens = tokens;
  inlineContext.view = view;
  const result = createInlineOutput([], 0);
  appendRange(
    0,
    inlineTokenCount(tokens),
    context.profile,
    inlineContext,
    result,
  );
  const last = result.lastText;
  if (last) {
    const removed = trimTrailingText(result);
    if (removed > 0) {
      last.position!.end.offset! -= removed;
      last.position!.end.column -= removed;
    }
    if (!last.value) {
      result.children.pop();
    }
  }
  return result;
}
