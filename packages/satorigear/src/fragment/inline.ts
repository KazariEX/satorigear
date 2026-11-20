import type { PhrasingContent, Text } from "mdast";
import { trimLineWhitespaceEnd } from "../block/lines.ts";
import { ScratchView } from "../block/scratch.ts";
import { BlockKind, boundaryBreak } from "../constants/block.ts";
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

// Text builders and decorators can change the preceding text. Finish their run at the next node boundary.
function appendTextRange(context: InlineBuildContext, output: InlineOutput, trimEnd: boolean): void {
  let index = context.tokenIndex;
  const end = inlineTokenCount(context.tokens);
  while (index < end) {
    const kind = inlineTokenKind(context.tokens, index);
    if (kind >= InlineRole.Leaf && kind < InlineRole.Decorate) {
      break;
    }
    const childStart = inlineTokenStart(context.tokens, index);
    if (kind < InlineRole.Leaf) {
      if (childStart > output.cursor) {
        appendGap(context, output, output.cursor, childStart);
      }
      const childEnd = inlineTokenEnd(context.tokens, index);
      if (kind === InlineKind.Newline) {
        trimTrailingText(context, output);
        appendText(context, output, "\n", childStart, childEnd, false);
      }
      else {
        const build = context.builders[kind] as InlineTextBuilder;
        appendText(context, output, build(index, context), childStart, childEnd, kind === InlineKind.LiteralText);
      }
      output.cursor = childEnd;
      index++;
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
  // Trailing whitespace is trimmed only at the end of the outer fragment.
  if (trimEnd && index === end) {
    trimTrailingText(context, output);
    if (output.pendingText && !output.pendingText.value) {
      output.children.pop();
    }
  }
  finishText(context, output);
  output.cursor = contentEnd;
  context.tokenIndex = index;
}

function buildLiteral(context: InlineBuildContext, start: number, end: number): Text {
  return {
    type: "text",
    value: context.view.text.slice(start, end),
    position: context.locator.positionAt(context.view.mapOffset(start), context.view.mapEnd(end)),
  };
}

function buildFragment(context: InlineBuildContext, cursor: number, closer: InlineKind): InlineFragment {
  const trimEnd = closer === InlineKind.None;
  const children: PhrasingContent[] = [];
  const tokens = context.tokens;
  const end = inlineTokenCount(tokens);
  let output: InlineOutput | undefined;
  while (context.tokenIndex < end) {
    const index = context.tokenIndex;
    const kind = inlineTokenKind(tokens, index);
    if (kind === closer) {
      break;
    }
    if (kind < InlineRole.Leaf || kind >= InlineRole.Decorate) {
      if (output) {
        output.cursor = cursor;
        output.pendingText = void 0;
      }
      else {
        output = {
          children,
          cursor,
          pendingText: void 0,
          pendingEnd: 0,
          pendingLiteral: "",
        };
      }
      appendTextRange(context, output, trimEnd);
      cursor = output.cursor;
      continue;
    }
    const startOffset = inlineTokenStart(tokens, index);
    if (cursor < startOffset) {
      children.push(buildLiteral(context, cursor, startOffset));
    }
    const sourceStart = context.view.mapOffset(startOffset);
    const start = context.locator.locationAt(sourceStart);
    let nested: PhrasingContent[] | undefined;
    if (kind >= InlineRole.Pair) {
      const start = inlineTokenEnd(tokens, index);
      const next = index + 1;
      context.tokenIndex = next;
      if (inlineTokenKind(tokens, next) === kind + 1) {
        const end = inlineTokenStart(tokens, next);
        nested = end <= start ? [] : [
          buildLiteral(context, start, end),
        ];
      }
      else {
        nested = buildFragment(context, start, kind + 1).children;
      }
    }
    const close = context.tokenIndex++;
    const endOffset = inlineTokenEnd(tokens, close);
    const position = {
      start,
      end: context.locator.locationAt(
        startOffset === endOffset ? sourceStart : context.view.mapEnd(endOffset),
      ),
    };
    const build = context.builders[kind];
    const node = nested
      ? (build as InlinePairBuilder)(index, close, position, nested, context)
      : (build as InlineLeafBuilder)(index, position, context);
    children.push(node);
    cursor = endOffset;
  }
  let tail = context.tokenIndex < end ? inlineTokenStart(tokens, context.tokenIndex) : context.view.text.length;
  if (cursor < tail && trimEnd) {
    tail = trimLineWhitespaceEnd(context.view.text, cursor, tail);
  }
  if (cursor < tail) {
    children.push(buildLiteral(context, cursor, tail));
  }
  return output ?? { children };
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

    const { tokenize } = context.profile;
    if (nodeLength === 2) {
      const chunk = tokenStart + 1;
      const start = blockTokens.start(chunk);
      const text = context.source.slice(start, blockTokens.end(chunk));
      const withBoundaryBreak = blockTokens.value(tokenStart) === boundaryBreak;
      tokens = tokenize(text, withBoundaryBreak, ScratchView.supports && !withBoundaryBreak ? start : void 0);
      if (tokens.length === 0) {
        const end = trimLineWhitespaceEnd(text, 0, text.length);
        return {
          children: end <= 0 ? [] : [
            {
              type: "text",
              value: text.slice(0, end),
              position: context.locator.positionAt(start, start + end),
            },
          ],
        };
      }
      view = context.inlineContext?.view ?? new SourceView();
      view.resetContiguous(text, start, withBoundaryBreak);
    }
    else {
      view = context.inlineContext?.view ?? new SourceView();
      view.reset(context.source, blockTokens, tokenStart, nodeLength);
      tokens = view.tokenize(tokenize, ScratchView.supports);
    }
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
      children: end <= 0 ? [] : [
        buildLiteral(inlineContext, 0, end),
      ],
    };
  }
  inlineContext.tokenIndex = 0;
  return buildFragment(inlineContext, 0, InlineKind.None);
}
