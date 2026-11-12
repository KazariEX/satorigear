import { Character } from "../constants/character.ts";
import { InlineKind, InlineRole } from "../constants/inline.ts";
import {
  appendResolvedRawToken,
  compileDelimiterConfigs,
  type DelimiterReplacement,
  type DelimiterRun,
  delimiterRunAt,
  resolveDelimiterScope,
} from "../inline/delimiter.ts";
import {
  appendInlineToken,
  copyInlineToken,
  inlineTokenCount,
  inlineTokenData,
  inlineTokenEnd,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
  rewriteInlineTokenTail,
} from "../inline/tokens.ts";
import { emptyArray } from "../primitives.ts";
import { attributesEnd } from "./features/attributes/shared.ts";
import { footnoteLabelAt } from "./features/footnote/shared.ts";
import { isMarkdownWhitespace, normalizeIdentifier } from "./utils.ts";
import type { DefinitionLookup } from "../block/tokens.ts";
import type { InlineResolverFactory } from "../inline/profile.ts";

interface InlineResolverOptions {
  component: boolean;
  footnote: boolean;
}

interface BracketFrame {
  open: number;
  close: number;
  parent: BracketFrame | undefined;
  state: number;
  candidateBottom: BracketFrame | undefined;
  candidateNext: BracketFrame | undefined;
  delimiterStart: number;
  resolvedEnd: number;
  logicalParent: BracketFrame | undefined;
  referenceParent: BracketFrame | undefined;
}

const enum FrameClaim {
  Raw,
  // Feature boundaries stay contiguous for close-path range checks.
  Footnote,
  Component,
  Span,
  AttributedSpan,
  Link,
  Reference,
  Consumed,
  // Claims are exclusive low-bit discriminants; flags occupy the higher bits.
  Mask = 7,
}

const enum FrameFlag {
  Image = 8,
  InLinkLabel = 16,
  LiteralBracket = 32,
}

// Without an opener, pairing and emission never access frame records.
const noBracketFrames: BracketFrame[] = [];

// Each frame keeps its syntax identity while analysis, pairing, and emission
// establish their own links and boundaries without changing a field's meaning.

function rewriteLinkCandidates(
  top: BracketFrame | undefined,
  bottom: BracketFrame | undefined,
): BracketFrame | undefined {
  // Only suffix membership matters, so retained links can be rebuilt in either order.
  let candidate = top;
  top = bottom;
  while (candidate && candidate !== bottom) {
    const next = candidate.candidateNext;
    const state = candidate.state;
    if (state === FrameClaim.Span) {
      candidate.state = FrameClaim.Raw;
    }
    else {
      candidate.state = state | FrameFlag.InLinkLabel;
      candidate.candidateNext = top;
      top = candidate;
    }
    candidate = next;
  }
  return top;
}

function referenceLabelEnd(source: string, start: number): number {
  if (source.charCodeAt(start) !== Character.LeftSquareBracket) {
    return -1;
  }
  let offset = start + 1;
  if (source.charCodeAt(offset) === Character.RightSquareBracket) {
    return offset + 1;
  }
  let characters = 0;
  let hasContent = false;
  while (offset < source.length && characters < 999) {
    const code = source.charCodeAt(offset);
    if (code === Character.RightSquareBracket) {
      return hasContent ? offset + 1 : -1;
    }
    if (code === Character.LeftSquareBracket) {
      return -1;
    }
    if (code === Character.ReverseSolidus) {
      if (offset + 1 >= source.length) {
        return -1;
      }
      hasContent = true;
      offset += 2;
    }
    else {
      hasContent ||= !isMarkdownWhitespace(code);
      offset++;
    }
    characters++;
  }
  return -1;
}

function acceptsShortcutLabel(source: string, start: number, end: number): boolean {
  let hasContent = false;
  let characters = 0;
  for (let offset = start; offset < end; offset++) {
    const code = source.charCodeAt(offset);
    hasContent ||= !isMarkdownWhitespace(code);
    if (
      code >= Character.HighSurrogateStart &&
      code <= Character.HighSurrogateEnd &&
      offset + 1 < end
    ) {
      const trailing = source.charCodeAt(offset + 1);
      if (trailing >= Character.LowSurrogateStart && trailing <= Character.LowSurrogateEnd) {
        offset++;
      }
    }
    if (++characters > 999) {
      return false;
    }
  }
  return hasContent;
}

function analyzeBrackets(
  source: string,
  tokens: InlineTokenStream,
  definitions: DefinitionLookup,
  options: InlineResolverOptions,
): BracketFrame[] {
  let frames: BracketFrame[] | undefined;
  let candidateTop: BracketFrame | undefined;
  let stackTop: BracketFrame | undefined;
  const count = inlineTokenCount(tokens);
  for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
    const kind = inlineTokenKind(tokens, tokenIndex);
    if (kind >= InlineKind.ImageOpen && kind <= InlineKind.BracketOpen) {
      const arena = frames ??= [];
      const frame: BracketFrame = {
        open: tokenIndex,
        close: -1,
        parent: stackTop,
        state: kind === InlineKind.ImageOpen ? FrameFlag.Image : FrameClaim.Raw,
        candidateBottom: candidateTop,
        candidateNext: void 0,
        delimiterStart: 0,
        resolvedEnd: 0,
        logicalParent: void 0,
        referenceParent: void 0,
      };
      arena.push(frame);
      stackTop = frame;
      continue;
    }
    if (kind !== InlineKind.LinkTail && kind !== InlineKind.BracketClose) {
      continue;
    }

    if (!stackTop) {
      continue;
    }
    const frame = stackTop;
    stackTop = frame.parent;
    frame.close = tokenIndex;
    const image = (frame.state & FrameFlag.Image) !== 0;

    if (options.footnote && kind === InlineKind.BracketClose) {
      const openToken = frame.open;
      const labelStart = inlineTokenStart(tokens, openToken) + (image ? 1 : 0);
      const label = footnoteLabelAt(source, labelStart, source.length);
      if (
        label?.end === inlineTokenEnd(tokens, tokenIndex) &&
        definitions.hasDefinition(label.definitionKey)
      ) {
        frame.state = FrameClaim.Footnote;
        candidateTop = frame.candidateBottom;
        continue;
      }
    }

    if (!options.component || image) {
      continue;
    }
    if (kind === InlineKind.LinkTail) {
      candidateTop = rewriteLinkCandidates(
        candidateTop,
        frame.candidateBottom,
      );
    }
    const openToken = frame.open;
    const componentToken = openToken - 1;
    if (
      componentToken >= 0 &&
      inlineTokenKind(tokens, componentToken) === InlineKind.InlineComponent &&
      inlineTokenEnd(tokens, componentToken) === inlineTokenStart(tokens, openToken)
    ) {
      frame.state = FrameClaim.Component;
      frame.candidateNext = candidateTop;
      candidateTop = frame;
      continue;
    }

    const close = inlineTokenStart(tokens, tokenIndex);
    const suffixStart = close + 1;
    const trailing = source.charCodeAt(suffixStart);
    if (
      trailing === Character.LeftParenthesis ||
      trailing === Character.LeftSquareBracket
    ) {
      continue;
    }
    const attributed = (
      trailing === Character.LeftCurlyBracket &&
      attributesEnd(source, suffixStart) !== void 0
    );
    frame.state = attributed ? FrameClaim.AttributedSpan : FrameClaim.Span;
    frame.candidateNext = candidateTop;
    candidateTop = frame;
  }
  return frames ?? noBracketFrames;
}

function resolvePairedSyntax(
  source: string,
  tokens: InlineTokenStream,
  frames: BracketFrame[],
  definitions: DefinitionLookup,
  delimiterByKind: ReturnType<typeof compileDelimiterConfigs>,
): readonly DelimiterReplacement[][] {
  // An empty definition table makes every non-resource bracket candidate literal.
  const hasDefinitions = frames.length > 0 && definitions.hasDefinitions();
  // Delimiter scopes share a reusable run prefix; frames checkpoint its logical length.
  let runs: DelimiterRun[] | undefined;
  let runCount = 0;
  let replacements: DelimiterReplacement[][] | undefined;
  let rawTop: BracketFrame | undefined;
  let logicalTop: BracketFrame | undefined;
  let frameCursor = 0;
  let consumedEnd = -1;
  let consumeFrames = false;
  let inactiveBefore = 0;
  let lastVisibleOpener = -1;
  let literalDepth = 0;

  const count = inlineTokenCount(tokens);
  for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
    const kind = inlineTokenKind(tokens, tokenIndex);
    const tokenStart = inlineTokenStart(tokens, tokenIndex);
    if (consumedEnd >= 0 && tokenStart >= consumedEnd) {
      consumedEnd = -1;
      consumeFrames = false;
    }
    const consuming = consumedEnd >= 0;

    const delimiter = delimiterByKind[kind];
    if (!consuming && delimiter) {
      const run = delimiterRunAt(source, tokens, tokenIndex, delimiter);
      if (run) {
        const arena = runs ??= [];
        const runIndex = runCount++;
        if (runIndex > 0) {
          run.previous = runIndex - 1;
          arena[runIndex - 1].next = runIndex;
        }
        arena[runIndex] = run;
      }
    }

    if (kind >= InlineKind.ImageOpen && kind <= InlineKind.BracketOpen) {
      const frame = frames[frameCursor++];
      rawTop = frame;
      if (consuming) {
        if (consumeFrames) {
          frame.state = FrameClaim.Consumed;
        }
        continue;
      }
      frame.delimiterStart = runCount;

      const state = frame.state;
      const claim = state & FrameClaim.Mask;
      if (claim === FrameClaim.Footnote) {
        const closeToken = frame.close;
        consumedEnd = inlineTokenEnd(tokens, closeToken);
        continue;
      }
      if (claim >= FrameClaim.Component && claim <= FrameClaim.AttributedSpan) {
        if (state & FrameFlag.InLinkLabel) {
          literalDepth++;
        }
        continue;
      }
      const image = kind === InlineKind.ImageOpen;
      if (literalDepth > 0 && !image) {
        frame.state = state | FrameFlag.LiteralBracket;
        continue;
      }
      frame.logicalParent = logicalTop;
      logicalTop = frame;
      lastVisibleOpener = tokenIndex;
      continue;
    }

    if (kind !== InlineKind.LinkTail && kind !== InlineKind.BracketClose) {
      continue;
    }
    const rawFrame = rawTop;
    if (rawFrame !== void 0) {
      rawTop = rawFrame.parent;
    }
    if (consuming) {
      if (consumeFrames && rawFrame !== void 0) {
        rawFrame.state = FrameClaim.Consumed;
      }
      continue;
    }

    const rawState = rawFrame === void 0 ? FrameClaim.Raw : rawFrame.state;
    const rawClaim = rawState & FrameClaim.Mask;
    let runStart = rawClaim >= FrameClaim.Footnote && rawClaim <= FrameClaim.AttributedSpan
      ? rawFrame!.delimiterStart
      : -1;
    const visible = runStart < 0 && (
      literalDepth <= 0 || rawFrame === void 0 || (rawState & FrameFlag.Image) !== 0
    );

    if (visible) {
      const frame = logicalTop;
      if (frame !== void 0) {
        logicalTop = frame.logicalParent;
      }
      if (frame !== void 0 && (kind === InlineKind.LinkTail || hasDefinitions)) {
        const openToken = frame.open;
        const image = (frame.state & FrameFlag.Image) !== 0;
        // A successful inner ordinary link deactivates each earlier non-image opener.
        if (image || openToken + 1 >= inactiveBefore) {
          const contentStart = inlineTokenEnd(tokens, openToken);
          const contentEnd = tokenStart;
          const tokenEnd = inlineTokenEnd(tokens, tokenIndex);
          let closeEnd = tokenEnd;
          let reference = false;
          let matched = kind === InlineKind.LinkTail;

          if (!matched) {
            const labelEnd = referenceLabelEnd(source, closeEnd);
            if (labelEnd > 0) {
              const explicit = source.slice(closeEnd + 1, labelEnd - 1);
              const label = explicit || source.slice(contentStart, contentEnd);
              matched = definitions.hasDefinition(normalizeIdentifier(label));
              if (matched) {
                closeEnd = labelEnd;
                reference = true;
              }
            }
            else if (
              lastVisibleOpener <= openToken &&
              acceptsShortcutLabel(source, contentStart, contentEnd) &&
              definitions.hasDefinition(normalizeIdentifier(source.slice(contentStart, contentEnd)))
            ) {
              matched = true;
              reference = true;
            }
          }

          if (matched) {
            frame.state = (reference ? FrameClaim.Reference : FrameClaim.Link) | (
              image ? FrameFlag.Image : 0
            );
            frame.close = tokenIndex;
            runStart = frame.delimiterStart;
            frame.resolvedEnd = closeEnd;
            if (!image) {
              inactiveBefore = openToken + 1;
            }
            if (closeEnd > tokenEnd) {
              consumedEnd = closeEnd;
              consumeFrames = true;
            }
          }
        }
      }
    }

    if (rawState & FrameFlag.InLinkLabel) {
      literalDepth--;
    }
    if (runStart >= 0 && runCount > runStart) {
      // Replacements retain the resolved suffix, so its run slots can be reused.
      if (runStart > 0) {
        runs![runStart].previous = -1;
        runs![runStart - 1].next = -1;
      }
      replacements = resolveDelimiterScope(runs!, runStart, replacements);
      runCount = runStart;
    }
  }
  if (runCount > 0) {
    replacements = resolveDelimiterScope(runs!, 0, replacements);
  }
  return replacements ?? emptyArray;
}

function appendReferenceBoundary(
  result: number[],
  tokens: InlineTokenStream,
  frame: BracketFrame,
  close: boolean,
): number {
  const token = close ? frame.close : frame.open;
  const state = frame.state;
  const claim = state & FrameClaim.Mask;
  const kind = (claim === FrameClaim.Reference ? InlineKind.ReferenceOpen : InlineKind.LinkOpen) +
    (state & FrameFlag.Image ? 2 : 0) +
    (close ? 1 : 0);
  const end = close ? frame.resolvedEnd : inlineTokenEnd(tokens, token);
  appendInlineToken(
    result,
    kind,
    inlineTokenStart(tokens, token),
    end,
    inlineTokenData(tokens, token),
  );
  return end;
}

function emitResolvedTokens(
  tokens: InlineTokenStream,
  frames: BracketFrame[],
  replacements: readonly DelimiterReplacement[][],
): InlineTokenStream {
  const result: number[] = [];
  let rawTop: BracketFrame | undefined;
  let referenceTop: BracketFrame | undefined;
  let frameCursor = 0;
  let skipEnd = -1;

  const count = inlineTokenCount(tokens);
  for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
    const kind = inlineTokenKind(tokens, tokenIndex);
    const tokenStart = inlineTokenStart(tokens, tokenIndex);
    if (skipEnd >= 0 && tokenStart >= skipEnd) {
      skipEnd = -1;
    }
    const skipping = skipEnd >= 0;

    if (kind >= InlineKind.ImageOpen && kind <= InlineKind.BracketOpen) {
      const frame = frames[frameCursor++];
      rawTop = frame;
      const state = frame.state;
      const claim = state & FrameClaim.Mask;
      if (!skipping) {
        if (claim === FrameClaim.Footnote) {
          const closeToken = frame.close;
          const start = inlineTokenStart(tokens, tokenIndex) + (kind === InlineKind.ImageOpen ? 1 : 0);
          skipEnd = inlineTokenEnd(tokens, closeToken);
          appendInlineToken(result, InlineKind.FootnoteReference, start, skipEnd);
        }
        else if (claim === FrameClaim.Component) {
          const closeToken = frame.close;
          const openEnd = inlineTokenEnd(tokens, tokenIndex);
          // Nonempty labels promote the adjacent leaf and include `[` in the pair opener.
          if (openEnd < inlineTokenStart(tokens, closeToken)) {
            rewriteInlineTokenTail(
              result,
              InlineKind.InlineComponentOpen,
              openEnd,
            );
          }
        }
        else if (claim >= FrameClaim.Span && claim <= FrameClaim.AttributedSpan) {
          appendInlineToken(
            result,
            InlineKind.InlineSpanOpen,
            inlineTokenStart(tokens, tokenIndex),
            inlineTokenEnd(tokens, tokenIndex),
          );
        }
        else if (claim === FrameClaim.Link || claim === FrameClaim.Reference) {
          appendReferenceBoundary(result, tokens, frame, false);
          frame.referenceParent = referenceTop;
          referenceTop = frame;
        }
        else if (claim === FrameClaim.Consumed) {
          skipEnd = inlineTokenEnd(tokens, frame.close);
        }
        else if (!(state & FrameFlag.LiteralBracket)) {
          appendResolvedRawToken(result, tokens, tokenIndex, replacements);
        }
      }
      continue;
    }

    if (kind === InlineKind.LinkTail || kind === InlineKind.BracketClose) {
      const rawFrame = rawTop;
      if (rawFrame !== void 0) {
        rawTop = rawFrame.parent;
      }
      const referenceFrame = referenceTop;
      const closesReference = referenceFrame !== void 0 &&
        referenceFrame.close === tokenIndex;

      if (!skipping) {
        if (closesReference) {
          referenceTop = referenceFrame.referenceParent;
          skipEnd = appendReferenceBoundary(result, tokens, referenceFrame, true);
        }
        else {
          const state = rawFrame === void 0 ? FrameClaim.Raw : rawFrame.state;
          const claim = state & FrameClaim.Mask;
          if (claim === FrameClaim.Component) {
            const openToken = rawFrame!.open;
            if (inlineTokenEnd(tokens, openToken) < tokenStart) {
              appendInlineToken(result, InlineKind.InlineComponentClose, tokenStart, tokenStart + 1);
            }
          }
          else if (claim >= FrameClaim.Span && claim <= FrameClaim.AttributedSpan) {
            appendInlineToken(result, InlineKind.InlineSpanClose, tokenStart, tokenStart + 1);
          }
          // Of the remaining claims, only a footnote replaces its entire source.
          else if (claim !== FrameClaim.Footnote && !(state & FrameFlag.LiteralBracket)) {
            if (kind >= InlineRole.Text) {
              copyInlineToken(result, tokens, tokenIndex);
            }
            else {
              appendResolvedRawToken(result, tokens, tokenIndex, replacements);
            }
          }
        }
      }

      continue;
    }

    if (!skipping) {
      if (kind >= InlineRole.Text) {
        copyInlineToken(result, tokens, tokenIndex);
      }
      else {
        appendResolvedRawToken(result, tokens, tokenIndex, replacements);
      }
    }
  }
  return result;
}

export function compileInlineResolver(options: InlineResolverOptions): InlineResolverFactory {
  return (delimiterConfigs) => {
    const delimiterByKind = compileDelimiterConfigs(delimiterConfigs);
    return (source, tokens, definitions) => {
      // Paired syntax is usually recognized sooner from its closing token.
      let tokenIndex = inlineTokenCount(tokens) - 1;
      for (; tokenIndex >= 0; tokenIndex--) {
        const kind = inlineTokenKind(tokens, tokenIndex);
        if (kind < InlineRole.Text) {
          break;
        }
      }
      if (tokenIndex < 0) {
        return tokens;
      }
      const frames = analyzeBrackets(
        source,
        tokens,
        definitions,
        options,
      );
      const replacements = resolvePairedSyntax(
        source,
        tokens,
        frames,
        definitions,
        delimiterByKind,
      );
      return emitResolvedTokens(tokens, frames, replacements);
    };
  };
}
