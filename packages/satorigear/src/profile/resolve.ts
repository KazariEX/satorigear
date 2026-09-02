import { Character } from "../constants/character.ts";
import { InlineKind } from "../constants/inline.ts";
import {
  appendResolvedDelimiterToken,
  compileDelimiterConfigs,
  type DelimiterReplacement,
  type DelimiterRun,
  delimiterRunAt,
  resolveDelimiterScope,
} from "../inline/delimiter.ts";
import {
  appendInlineToken,
  inlineTokenCount,
  inlineTokenData,
  inlineTokenEnd,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
  rewriteInlineTokenTail,
} from "../inline/tokens.ts";
import { attributesEnd } from "./features/attributes/shared.ts";
import { footnoteLabelAt } from "./features/footnote/shared.ts";
import { isMarkdownWhitespace, normalizeAssociationLabel } from "./utils.ts";
import type { DefinitionLookup } from "../block/tokens.ts";
import type { InlineResolverFactory } from "../inline/profile.ts";

interface InlineResolverOptions {
  component: boolean;
  footnote: boolean;
}

const enum FrameSlot {
  OpenToken,
  CloseToken,
  WorkspaceA,
  WorkspaceB,
  Parent,
  State,
  Stride,
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

const enum ResolutionFlag {
  Rewrite = 1,
}

const frameHeaderSize = 1;
// Without an opener, no downstream frame write can reach this shared header.
const noBracketFrames = [0];
const noDelimiterReplacements: DelimiterReplacement[][] = [];

// Analysis uses A for candidate bottoms and B for candidate links. Resolution reuses
// A for delimiter checkpoints then resolved ends, and B for logical then resolved parents.

function setFrameState(frames: number[], frame: number, state: number): void {
  frames[frame + FrameSlot.State] = state;
  frames[0] = ResolutionFlag.Rewrite;
}

function rewriteLinkCandidates(
  frames: number[],
  top: number,
  bottom: number,
): number {
  // Only suffix membership matters, so retained links can be rebuilt in either order.
  let candidate = top;
  top = bottom;
  while (candidate !== bottom) {
    const next = frames[candidate + FrameSlot.WorkspaceB];
    const state = frames[candidate + FrameSlot.State];
    if (state === FrameClaim.Span) {
      frames[candidate + FrameSlot.State] = FrameClaim.Raw;
    }
    else {
      frames[candidate + FrameSlot.State] = state | FrameFlag.InLinkLabel;
      frames[candidate + FrameSlot.WorkspaceB] = top;
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
): number[] {
  let frames: number[] | undefined;
  let candidateTop = -1;
  let stackTop = -1;
  const count = inlineTokenCount(tokens);
  for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
    const kind = inlineTokenKind(tokens, tokenIndex);
    if (kind >= InlineKind.ImageOpen && kind <= InlineKind.BracketOpen) {
      const arena = frames ??= [0];
      const frame = arena.length;
      // Append one complete frame in `FrameSlot` order before advancing the stack top.
      arena.push(
        tokenIndex,
        -1,
        candidateTop,
        -1,
        stackTop,
        kind === InlineKind.ImageOpen ? FrameFlag.Image : FrameClaim.Raw,
      );
      stackTop = frame;
      continue;
    }
    if (kind < InlineKind.LinkTail || kind > InlineKind.BracketClose) {
      continue;
    }

    if (stackTop < 0) {
      continue;
    }
    const frame = stackTop;
    const arena = frames!;
    stackTop = arena[frame + FrameSlot.Parent];
    arena[frame + FrameSlot.CloseToken] = tokenIndex;
    const image = (arena[frame + FrameSlot.State] & FrameFlag.Image) !== 0;

    if (options.footnote && kind === InlineKind.BracketClose) {
      const openToken = arena[frame + FrameSlot.OpenToken];
      const labelStart = inlineTokenStart(tokens, openToken) + (image ? 1 : 0);
      const label = footnoteLabelAt(source, labelStart, source.length);
      if (
        label &&
        label.end === inlineTokenEnd(tokens, tokenIndex) &&
        definitions.hasDefinition(label.definitionKey)
      ) {
        setFrameState(arena, frame, FrameClaim.Footnote);
        candidateTop = arena[frame + FrameSlot.WorkspaceA];
        continue;
      }
    }

    if (!options.component || image) {
      continue;
    }
    if (kind === InlineKind.LinkTail) {
      candidateTop = rewriteLinkCandidates(
        arena,
        candidateTop,
        arena[frame + FrameSlot.WorkspaceA],
      );
    }
    const openToken = arena[frame + FrameSlot.OpenToken];
    const componentToken = openToken - 1;
    if (
      componentToken >= 0 &&
      inlineTokenKind(tokens, componentToken) === InlineKind.InlineComponent &&
      inlineTokenEnd(tokens, componentToken) === inlineTokenStart(tokens, openToken)
    ) {
      setFrameState(arena, frame, FrameClaim.Component);
      arena[frame + FrameSlot.WorkspaceB] = candidateTop;
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
    setFrameState(
      arena,
      frame,
      attributed ? FrameClaim.AttributedSpan : FrameClaim.Span,
    );
    arena[frame + FrameSlot.WorkspaceB] = candidateTop;
    candidateTop = frame;
  }
  return frames ?? noBracketFrames;
}

function resolvePairedSyntax(
  source: string,
  tokens: InlineTokenStream,
  frames: number[],
  definitions: DefinitionLookup,
  delimiterByKind: ReturnType<typeof compileDelimiterConfigs>,
): DelimiterReplacement[][] | undefined {
  // An empty definition table makes every non-resource bracket candidate literal.
  const hasDefinitions = frames.length > frameHeaderSize && definitions.hasDefinitions();
  // Delimiter scopes share a reusable run prefix; frames checkpoint its logical length.
  let runs: DelimiterRun[] | undefined;
  let runCount = 0;
  let replacements: DelimiterReplacement[][] | undefined;
  let rawTop = -1;
  let logicalTop = -1;
  let frameCursor = frameHeaderSize;
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
      const frame = frameCursor;
      frameCursor += FrameSlot.Stride;
      rawTop = frame;
      if (consuming) {
        if (consumeFrames) {
          setFrameState(frames, frame, FrameClaim.Consumed);
        }
        continue;
      }
      frames[frame + FrameSlot.WorkspaceA] = runCount;

      const state = frames[frame + FrameSlot.State];
      const claim = state & FrameClaim.Mask;
      if (claim === FrameClaim.Footnote) {
        const closeToken = frames[frame + FrameSlot.CloseToken];
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
        frames[frame + FrameSlot.State] = state | FrameFlag.LiteralBracket;
        continue;
      }
      frames[frame + FrameSlot.WorkspaceB] = logicalTop;
      logicalTop = frame;
      lastVisibleOpener = tokenIndex;
      continue;
    }

    if (kind < InlineKind.LinkTail || kind > InlineKind.BracketClose) {
      continue;
    }
    const rawFrame = rawTop;
    if (rawFrame >= 0) {
      rawTop = frames[rawFrame + FrameSlot.Parent];
    }
    if (consuming) {
      if (consumeFrames && rawFrame >= 0) {
        setFrameState(frames, rawFrame, FrameClaim.Consumed);
      }
      continue;
    }

    const rawState = rawFrame < 0 ? FrameClaim.Raw : frames[rawFrame + FrameSlot.State];
    const rawClaim = rawState & FrameClaim.Mask;
    let runStart = rawClaim >= FrameClaim.Footnote && rawClaim <= FrameClaim.AttributedSpan
      ? frames[rawFrame + FrameSlot.WorkspaceA]
      : -1;
    const visible = runStart < 0 && (
      literalDepth <= 0 || rawFrame < 0 || (rawState & FrameFlag.Image) !== 0
    );

    if (visible) {
      const frame = logicalTop;
      if (frame >= 0) {
        logicalTop = frames[frame + FrameSlot.WorkspaceB];
      }
      if (frame >= 0 && (kind === InlineKind.LinkTail || hasDefinitions)) {
        const openToken = frames[frame + FrameSlot.OpenToken];
        const image = (frames[frame + FrameSlot.State] & FrameFlag.Image) !== 0;
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
              matched = definitions.hasDefinition(normalizeAssociationLabel(label));
              if (matched) {
                closeEnd = labelEnd;
                reference = true;
              }
            }
            else if (
              lastVisibleOpener <= openToken &&
              acceptsShortcutLabel(source, contentStart, contentEnd) &&
              definitions.hasDefinition(normalizeAssociationLabel(source.slice(contentStart, contentEnd)))
            ) {
              matched = true;
              reference = true;
            }
          }

          if (matched) {
            setFrameState(
              frames,
              frame,
              (reference ? FrameClaim.Reference : FrameClaim.Link) |
                (image ? FrameFlag.Image : 0),
            );
            frames[frame + FrameSlot.CloseToken] = tokenIndex;
            runStart = frames[frame + FrameSlot.WorkspaceA];
            frames[frame + FrameSlot.WorkspaceA] = closeEnd;
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
  return replacements;
}

function appendReferenceBoundary(
  result: number[],
  tokens: InlineTokenStream,
  frames: readonly number[],
  frame: number,
  close: boolean,
): number {
  const token = frames[frame + (close ? FrameSlot.CloseToken : FrameSlot.OpenToken)];
  const state = frames[frame + FrameSlot.State];
  const claim = state & FrameClaim.Mask;
  const kind = (claim === FrameClaim.Reference ? InlineKind.ReferenceOpen : InlineKind.LinkOpen) +
    (state & FrameFlag.Image ? 2 : 0) +
    (close ? 1 : 0);
  const end = close
    ? frames[frame + FrameSlot.WorkspaceA]
    : inlineTokenEnd(tokens, token);
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
  frames: number[],
  replacements: DelimiterReplacement[][],
): InlineTokenStream {
  const result: number[] = [];
  let rawTop = -1;
  let referenceTop = -1;
  let frameCursor = frameHeaderSize;
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
      const frame = frameCursor;
      frameCursor += FrameSlot.Stride;
      rawTop = frame;
      const state = frames[frame + FrameSlot.State];
      const claim = state & FrameClaim.Mask;
      if (!skipping) {
        if (claim === FrameClaim.Footnote) {
          const closeToken = frames[frame + FrameSlot.CloseToken];
          const start = inlineTokenStart(tokens, tokenIndex) + (kind === InlineKind.ImageOpen ? 1 : 0);
          skipEnd = inlineTokenEnd(tokens, closeToken);
          appendInlineToken(result, InlineKind.FootnoteReference, start, skipEnd);
        }
        else if (claim === FrameClaim.Component) {
          const closeToken = frames[frame + FrameSlot.CloseToken];
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
          appendReferenceBoundary(result, tokens, frames, frame, false);
          frames[frame + FrameSlot.WorkspaceB] = referenceTop;
          referenceTop = frame;
        }
        else if (claim === FrameClaim.Consumed) {
          skipEnd = inlineTokenEnd(tokens, frames[frame + FrameSlot.CloseToken]);
        }
        else if (!(state & FrameFlag.LiteralBracket)) {
          appendResolvedDelimiterToken(result, tokens, tokenIndex, replacements);
        }
      }
      continue;
    }

    if (kind >= InlineKind.LinkTail && kind <= InlineKind.BracketClose) {
      const rawFrame = rawTop;
      if (rawFrame >= 0) {
        rawTop = frames[rawFrame + FrameSlot.Parent];
      }
      const referenceFrame = referenceTop;
      const closesReference = referenceFrame >= 0 &&
        frames[referenceFrame + FrameSlot.CloseToken] === tokenIndex;

      if (!skipping) {
        if (closesReference) {
          referenceTop = frames[referenceFrame + FrameSlot.WorkspaceB];
          skipEnd = appendReferenceBoundary(result, tokens, frames, referenceFrame, true);
        }
        else if (rawFrame >= 0) {
          const state = frames[rawFrame + FrameSlot.State];
          const claim = state & FrameClaim.Mask;
          if (claim === FrameClaim.Component) {
            const openToken = frames[rawFrame + FrameSlot.OpenToken];
            if (inlineTokenEnd(tokens, openToken) < tokenStart) {
              appendInlineToken(result, InlineKind.InlineComponentClose, tokenStart, tokenStart + 1);
            }
          }
          else if (claim >= FrameClaim.Span && claim <= FrameClaim.AttributedSpan) {
            appendInlineToken(result, InlineKind.InlineSpanClose, tokenStart, tokenStart + 1);
          }
          // Of the remaining claims, only a footnote replaces its entire source.
          else if (claim !== FrameClaim.Footnote && !(state & FrameFlag.LiteralBracket)) {
            appendResolvedDelimiterToken(result, tokens, tokenIndex, replacements);
          }
        }
        else {
          appendResolvedDelimiterToken(result, tokens, tokenIndex, replacements);
        }
      }

      continue;
    }

    if (!skipping) {
      appendResolvedDelimiterToken(result, tokens, tokenIndex, replacements);
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
        if (kind >= InlineKind.AsteriskRun && kind <= InlineKind.BracketClose) {
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
      ) ?? noDelimiterReplacements;
      return frames[0] & ResolutionFlag.Rewrite || replacements.length > 0
        ? emitResolvedTokens(tokens, frames, replacements)
        : tokens;
    };
  };
}
