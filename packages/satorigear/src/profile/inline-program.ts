import { Character } from "../constants/character.ts";
import { InlineKind } from "../constants/inline.ts";
import {
  appendResolvedDelimiterToken,
  compileDelimiterConfigs,
  type DelimiterRun,
  delimiterRunAt,
  resolveDelimiterMatches,
} from "../inline/delimiter.ts";
import {
  appendInlineToken,
  inlineTokenCount,
  inlineTokenData,
  inlineTokenEnd,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
} from "../inline/tokens.ts";
import { attributesEnd } from "./features/attributes/syntax.ts";
import { footnoteLabelAt } from "./features/footnote/shared.ts";
import { normalizeAssociationLabel } from "./utils.ts";
import type { InlineResolutionContext, InlineResolverCompiler } from "../inline/profile.ts";

interface InlineProgramOptions {
  component: boolean;
  footnote: boolean;
}

const enum FrameSlot {
  OpenToken,
  CloseToken,
  WorkspaceA,
  WorkspaceB,
  WorkspaceC,
  State,
  ResolvedEnd,
  Stride,
}

const enum FrameClaim {
  Raw,
  Footnote,
  Component,
  Span,
  Link,
  Reference,
  Consumed,
  // Claims are exclusive low-bit discriminants; flags occupy the higher bits.
  Mask = 7,
}

const enum FrameFlag {
  Attributed = 8,
  InLinkLabel = 16,
}

const enum Discovery {
  Bracket = 1,
  Delimiter = 2,
}

const frameHeaderSize = 1;
const noBracketFrames = Object.freeze([0]);
const delimiterOnlyFrames = Object.freeze([Discovery.Delimiter]);
const noDelimiterReplacements: ReturnType<typeof resolveDelimiterMatches> = [];

// Each pass overwrites these phase-local slots before reading them. Analysis
// uses A/B for candidate first/last; C stores the parent while a frame is open
// and becomes candidate-next only after close. Later passes reuse all three as
// intrusive stack and scope links.

function frameClaim(frames: readonly number[], frame: number): FrameClaim {
  return frames[frame + FrameSlot.State] & FrameClaim.Mask;
}

function setFrameClaim(frames: number[], frame: number, claim: FrameClaim): void {
  frames[frame + FrameSlot.State] = (frames[frame + FrameSlot.State] & ~FrameClaim.Mask) | claim;
}

function appendCandidate(frames: number[], owner: number, candidate: number): void {
  frames[candidate + FrameSlot.WorkspaceC] = -1;
  const last = frames[owner + FrameSlot.WorkspaceB];
  if (last >= 0) {
    frames[last + FrameSlot.WorkspaceC] = candidate;
  }
  else {
    frames[owner + FrameSlot.WorkspaceA] = candidate;
  }
  frames[owner + FrameSlot.WorkspaceB] = candidate;
}

function promoteCandidates(
  frames: number[],
  owner: number,
  source: number,
): void {
  if (owner < 0) {
    return;
  }
  const first = frames[source + FrameSlot.WorkspaceA];
  if (first < 0) {
    return;
  }
  const last = frames[source + FrameSlot.WorkspaceB];
  const ownerLast = frames[owner + FrameSlot.WorkspaceB];
  if (ownerLast >= 0) {
    frames[ownerLast + FrameSlot.WorkspaceC] = first;
  }
  else {
    frames[owner + FrameSlot.WorkspaceA] = first;
  }
  frames[owner + FrameSlot.WorkspaceB] = last;
}

function rewriteLinkCandidates(frames: number[], owner: number): void {
  let candidate = frames[owner + FrameSlot.WorkspaceA];
  frames[owner + FrameSlot.WorkspaceA] = -1;
  frames[owner + FrameSlot.WorkspaceB] = -1;
  while (candidate >= 0) {
    const next = frames[candidate + FrameSlot.WorkspaceC];
    rewriteLinkCandidates(frames, candidate);

    const state = frames[candidate + FrameSlot.State];
    if (
      (state & FrameClaim.Mask) === FrameClaim.Span &&
      !(state & FrameFlag.Attributed)
    ) {
      frames[candidate + FrameSlot.State] = FrameClaim.Raw;
      promoteCandidates(frames, owner, candidate);
    }
    else {
      frames[candidate + FrameSlot.State] = state | FrameFlag.InLinkLabel;
      appendCandidate(frames, owner, candidate);
    }
    candidate = next;
  }
}

function allocateFrame(frames: number[], openToken: number, parent: number): number {
  const frame = frames.length;
  frames.push(openToken, -1, -1, -1, parent, FrameClaim.Raw, 0);
  return frame;
}

function isImageFrame(tokens: InlineTokenStream, frames: readonly number[], frame: number): boolean {
  return inlineTokenKind(tokens, frames[frame + FrameSlot.OpenToken]) === InlineKind.ImageOpen;
}

function hasAdjacentComponent(
  tokens: InlineTokenStream,
  frames: readonly number[],
  frame: number,
): boolean {
  const openToken = frames[frame + FrameSlot.OpenToken];
  const componentToken = openToken - 1;
  return componentToken >= 0 &&
    inlineTokenKind(tokens, componentToken) === InlineKind.InlineComponentOpen &&
    inlineTokenEnd(tokens, componentToken) === inlineTokenStart(tokens, openToken);
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
      hasContent ||= (
        code !== Character.CharacterTabulation &&
        code !== Character.LineFeed &&
        code !== Character.CarriageReturn &&
        code !== Character.Space
      );
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
    hasContent ||= (
      code !== Character.CharacterTabulation &&
      code !== Character.LineFeed &&
      code !== Character.CarriageReturn &&
      code !== Character.Space
    );
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
  delimiterByKind: ReturnType<typeof compileDelimiterConfigs>,
  context: InlineResolutionContext,
  options: InlineProgramOptions,
): readonly number[] {
  let discovery = 0;
  let frames: number[] | undefined;
  let stackTop = -1;
  const count = inlineTokenCount(tokens);
  for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
    const kind = inlineTokenKind(tokens, tokenIndex);
    if (delimiterByKind[kind]) {
      discovery |= Discovery.Delimiter;
    }
    if (kind === InlineKind.BracketOpen || kind === InlineKind.ImageOpen) {
      discovery |= Discovery.Bracket;
      frames ??= [discovery];
      stackTop = allocateFrame(frames, tokenIndex, stackTop);
      continue;
    }
    if (kind !== InlineKind.BracketClose && kind !== InlineKind.LinkTail) {
      continue;
    }

    if (stackTop < 0) {
      continue;
    }
    const frame = stackTop;
    const arena = frames!;
    const parent = arena[frame + FrameSlot.WorkspaceC];
    stackTop = parent;
    arena[frame + FrameSlot.CloseToken] = tokenIndex;
    const image = isImageFrame(tokens, arena, frame);

    if (options.footnote && kind === InlineKind.BracketClose) {
      const openToken = arena[frame + FrameSlot.OpenToken];
      const labelStart = inlineTokenStart(tokens, openToken) + (image ? 1 : 0);
      const label = footnoteLabelAt(source, labelStart, source.length);
      if (
        label &&
        label.end === inlineTokenEnd(tokens, tokenIndex) &&
        context.hasDefinition(label.definitionKey)
      ) {
        setFrameClaim(arena, frame, FrameClaim.Footnote);
        continue;
      }
    }

    if (!options.component) {
      continue;
    }
    if (image) {
      promoteCandidates(arena, parent, frame);
      continue;
    }
    if (kind === InlineKind.LinkTail) {
      rewriteLinkCandidates(arena, frame);
    }
    if (hasAdjacentComponent(tokens, arena, frame)) {
      setFrameClaim(arena, frame, FrameClaim.Component);
      if (parent >= 0) {
        appendCandidate(arena, parent, frame);
      }
      continue;
    }

    const close = inlineTokenStart(tokens, tokenIndex);
    const trailing = source.charCodeAt(close + 1);
    if (
      trailing === Character.LeftParenthesis ||
      trailing === Character.LeftSquareBracket
    ) {
      promoteCandidates(arena, parent, frame);
      continue;
    }
    const attributesStart = close + 1;
    const attributed = (
      source.charCodeAt(attributesStart) === Character.LeftCurlyBracket &&
      attributesEnd(source, attributesStart) !== void 0
    );
    arena[frame + FrameSlot.State] = FrameClaim.Span |
      (attributed ? FrameFlag.Attributed : 0);
    if (parent >= 0) {
      appendCandidate(arena, parent, frame);
    }
  }

  if (options.component && stackTop >= 0) {
    const arena = frames!;
    while (stackTop >= 0) {
      const frame = stackTop;
      stackTop = arena[frame + FrameSlot.WorkspaceC];
      promoteCandidates(arena, stackTop, frame);
    }
  }
  if (frames) {
    frames[0] = discovery;
    return frames;
  }
  return discovery & Discovery.Delimiter ? delimiterOnlyFrames : noBracketFrames;
}

function resolveReferences(
  source: string,
  tokens: InlineTokenStream,
  frames: number[],
  context: InlineResolutionContext,
): void {
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

    if (kind === InlineKind.BracketOpen || kind === InlineKind.ImageOpen) {
      const frame = frameCursor;
      frameCursor += FrameSlot.Stride;
      frames[frame + FrameSlot.WorkspaceA] = rawTop;
      rawTop = frame;
      if (consuming) {
        if (consumeFrames) {
          setFrameClaim(frames, frame, FrameClaim.Consumed);
        }
        continue;
      }

      const claim = frameClaim(frames, frame);
      if (claim === FrameClaim.Footnote) {
        const closeToken = frames[frame + FrameSlot.CloseToken];
        consumedEnd = inlineTokenEnd(tokens, closeToken);
        continue;
      }
      if (claim === FrameClaim.Component || claim === FrameClaim.Span) {
        if (frames[frame + FrameSlot.State] & FrameFlag.InLinkLabel) {
          literalDepth++;
        }
        continue;
      }
      const image = kind === InlineKind.ImageOpen;
      if (literalDepth > 0 && !image) {
        continue;
      }
      frames[frame + FrameSlot.WorkspaceB] = logicalTop;
      logicalTop = frame;
      lastVisibleOpener = tokenIndex;
      continue;
    }

    if (kind !== InlineKind.BracketClose && kind !== InlineKind.LinkTail) {
      continue;
    }
    const rawFrame = rawTop;
    if (rawFrame >= 0) {
      rawTop = frames[rawFrame + FrameSlot.WorkspaceA];
    }
    if (consuming) {
      if (consumeFrames && rawFrame >= 0) {
        setFrameClaim(frames, rawFrame, FrameClaim.Consumed);
      }
      continue;
    }

    const rawClaim = rawFrame < 0 ? FrameClaim.Raw : frameClaim(frames, rawFrame);
    const featureBoundary = (
      rawClaim === FrameClaim.Footnote ||
      rawClaim === FrameClaim.Component ||
      rawClaim === FrameClaim.Span
    );
    const visible = !featureBoundary && (
      literalDepth <= 0 || rawFrame < 0 || isImageFrame(tokens, frames, rawFrame)
    );

    if (visible) {
      const frame = logicalTop;
      if (frame >= 0) {
        logicalTop = frames[frame + FrameSlot.WorkspaceB];
        const openToken = frames[frame + FrameSlot.OpenToken];
        const image = isImageFrame(tokens, frames, frame);
        if (!image && openToken + 1 < inactiveBefore) {
          // A successful inner ordinary link deactivates this earlier opener.
        }
        else {
          const contentStart = inlineTokenEnd(tokens, openToken);
          const contentEnd = tokenStart;
          let closeEnd = inlineTokenEnd(tokens, tokenIndex);
          let reference = false;
          let matched = kind === InlineKind.LinkTail;

          if (!matched) {
            const labelEnd = referenceLabelEnd(source, closeEnd);
            if (labelEnd > 0) {
              const explicit = source.slice(closeEnd + 1, labelEnd - 1);
              const label = explicit || source.slice(contentStart, contentEnd);
              matched = context.hasDefinition(normalizeAssociationLabel(label));
              if (matched) {
                closeEnd = labelEnd;
                reference = true;
              }
            }
            else if (
              lastVisibleOpener <= openToken &&
              acceptsShortcutLabel(source, contentStart, contentEnd) &&
              context.hasDefinition(normalizeAssociationLabel(source.slice(contentStart, contentEnd)))
            ) {
              matched = true;
              reference = true;
            }
          }

          if (matched) {
            setFrameClaim(
              frames,
              frame,
              reference ? FrameClaim.Reference : FrameClaim.Link,
            );
            frames[frame + FrameSlot.CloseToken] = tokenIndex;
            frames[frame + FrameSlot.ResolvedEnd] = closeEnd;
            if (!image) {
              inactiveBefore = Math.max(inactiveBefore, openToken + 1);
            }
            if (closeEnd > inlineTokenEnd(tokens, tokenIndex)) {
              consumedEnd = closeEnd;
              consumeFrames = true;
            }
          }
        }
      }
    }

    if (
      rawFrame >= 0 &&
      (rawClaim === FrameClaim.Component || rawClaim === FrameClaim.Span) &&
      frames[rawFrame + FrameSlot.State] & FrameFlag.InLinkLabel
    ) {
      literalDepth--;
    }
  }
}

function assignDelimiterScopes(
  source: string,
  tokens: InlineTokenStream,
  frames: readonly number[],
  delimiterByKind: ReturnType<typeof compileDelimiterConfigs>,
): DelimiterRun[] | undefined {
  // Bracket openers imply a mutable arena; delimiter-only sentinels never enter these writes.
  const workspace = frames as number[];
  let runs: DelimiterRun[] | undefined;
  let activeTop = -1;
  let rootLastRun = -1;
  let frameCursor = frameHeaderSize;
  let skipEnd = -1;

  const count = inlineTokenCount(tokens);
  for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
    while (
      activeTop >= 0 &&
      frames[activeTop + FrameSlot.CloseToken] === tokenIndex
    ) {
      const frame = activeTop;
      activeTop = frames[frame + FrameSlot.WorkspaceA];
      const resolvedEnd = frames[frame + FrameSlot.ResolvedEnd];
      if (resolvedEnd > inlineTokenEnd(tokens, tokenIndex)) {
        skipEnd = resolvedEnd;
      }
    }

    const kind = inlineTokenKind(tokens, tokenIndex);
    const tokenStart = inlineTokenStart(tokens, tokenIndex);
    if (skipEnd >= 0 && tokenStart >= skipEnd) {
      skipEnd = -1;
    }
    if (kind === InlineKind.BracketOpen || kind === InlineKind.ImageOpen) {
      const frame = frameCursor;
      frameCursor += FrameSlot.Stride;
      const claim = frameClaim(frames, frame);
      if (claim === FrameClaim.Footnote) {
        // Footnotes have no raw bracket children, so skipping preserves the enclosing scope.
        skipEnd = inlineTokenEnd(tokens, frames[frame + FrameSlot.CloseToken]);
        continue;
      }
      // Resolved bracket frames own delimiter scopes; an empty component has no content scope.
      const isolates = (
        claim === FrameClaim.Span ||
        claim === FrameClaim.Link ||
        claim === FrameClaim.Reference || (
          claim === FrameClaim.Component &&
          inlineTokenEnd(tokens, frames[frame + FrameSlot.OpenToken]) <
          inlineTokenStart(tokens, frames[frame + FrameSlot.CloseToken])
        )
      );
      if (isolates) {
        workspace[frame + FrameSlot.WorkspaceA] = activeTop;
        activeTop = frame;
        workspace[frame + FrameSlot.WorkspaceC] = -1;
      }
    }

    if (skipEnd < 0) {
      const run = delimiterRunAt(
        source,
        tokens,
        tokenIndex,
        delimiterByKind,
      );
      if (run) {
        const runIndex = runs?.length ?? 0;
        const previous = activeTop < 0
          ? rootLastRun
          : frames[activeTop + FrameSlot.WorkspaceC];
        if (previous >= 0) {
          run.previous = previous;
          runs![previous].next = runIndex;
        }
        if (activeTop < 0) {
          rootLastRun = runIndex;
        }
        else {
          workspace[activeTop + FrameSlot.WorkspaceC] = runIndex;
        }
        (runs ??= []).push(run);
      }
    }
  }
  return runs;
}

function hasBracketRewrite(frames: readonly number[]): boolean {
  for (let frame = frameHeaderSize; frame < frames.length; frame += FrameSlot.Stride) {
    if (frameClaim(frames, frame) !== FrameClaim.Raw) {
      return true;
    }
  }
  return false;
}

function appendReferenceBoundary(
  result: number[],
  tokens: InlineTokenStream,
  frames: readonly number[],
  frame: number,
  close: boolean,
): number {
  const token = frames[frame + (close ? FrameSlot.CloseToken : FrameSlot.OpenToken)];
  const claim = frameClaim(frames, frame);
  const kind = (claim === FrameClaim.Reference ? InlineKind.ReferenceOpen : InlineKind.LinkOpen) +
    (isImageFrame(tokens, frames, frame) ? 2 : 0) +
    (close ? 1 : 0);
  const end = close
    ? frames[frame + FrameSlot.ResolvedEnd]
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
  frames: readonly number[],
  replacements: ReturnType<typeof resolveDelimiterMatches>,
): InlineTokenStream {
  // Bracket openers imply a mutable arena; delimiter-only sentinels never enter these writes.
  const workspace = frames as number[];
  const result: number[] = [];
  let rawTop = -1;
  let referenceTop = -1;
  let frameCursor = frameHeaderSize;
  let skipEnd = -1;
  let literalDepth = 0;

  const count = inlineTokenCount(tokens);
  for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
    const kind = inlineTokenKind(tokens, tokenIndex);
    const tokenStart = inlineTokenStart(tokens, tokenIndex);
    if (skipEnd >= 0 && tokenStart >= skipEnd) {
      skipEnd = -1;
    }
    const skipping = skipEnd >= 0;

    if (kind === InlineKind.BracketOpen || kind === InlineKind.ImageOpen) {
      const frame = frameCursor;
      frameCursor += FrameSlot.Stride;
      workspace[frame + FrameSlot.WorkspaceA] = rawTop;
      rawTop = frame;
      const claim = frameClaim(frames, frame);
      if (!skipping) {
        if (claim === FrameClaim.Footnote) {
          const closeToken = frames[frame + FrameSlot.CloseToken];
          const start = inlineTokenStart(tokens, tokenIndex) + (kind === InlineKind.ImageOpen ? 1 : 0);
          skipEnd = inlineTokenEnd(tokens, closeToken);
          appendInlineToken(result, InlineKind.FootnoteReference, start, skipEnd);
        }
        else if (claim === FrameClaim.Component) {
          const closeToken = frames[frame + FrameSlot.CloseToken];
          if (inlineTokenEnd(tokens, tokenIndex) < inlineTokenStart(tokens, closeToken)) {
            appendInlineToken(
              result,
              InlineKind.InlineComponentLabelOpen,
              inlineTokenStart(tokens, tokenIndex),
              inlineTokenEnd(tokens, tokenIndex),
            );
          }
        }
        else if (claim === FrameClaim.Span) {
          appendInlineToken(
            result,
            InlineKind.InlineSpanOpen,
            inlineTokenStart(tokens, tokenIndex),
            inlineTokenEnd(tokens, tokenIndex),
          );
        }
        else if (claim === FrameClaim.Link || claim === FrameClaim.Reference) {
          appendReferenceBoundary(result, tokens, frames, frame, false);
          workspace[frame + FrameSlot.WorkspaceB] = referenceTop;
          referenceTop = frame;
        }
        else if (claim === FrameClaim.Consumed) {
          skipEnd = inlineTokenEnd(tokens, frames[frame + FrameSlot.CloseToken]);
        }
        else if (!(literalDepth > 0 && kind !== InlineKind.ImageOpen)) {
          appendResolvedDelimiterToken(result, tokens, tokenIndex, replacements);
        }
      }

      if (
        (claim === FrameClaim.Component || claim === FrameClaim.Span) &&
        frames[frame + FrameSlot.State] & FrameFlag.InLinkLabel
      ) {
        literalDepth++;
      }
      continue;
    }

    if (kind === InlineKind.BracketClose || kind === InlineKind.LinkTail) {
      const rawFrame = rawTop;
      if (rawFrame >= 0) {
        rawTop = frames[rawFrame + FrameSlot.WorkspaceA];
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
          const claim = frameClaim(frames, rawFrame);
          if (claim === FrameClaim.Component) {
            const openToken = frames[rawFrame + FrameSlot.OpenToken];
            if (inlineTokenEnd(tokens, openToken) < tokenStart) {
              appendInlineToken(result, InlineKind.InlineComponentLabelClose, tokenStart, tokenStart + 1);
            }
          }
          else if (claim === FrameClaim.Span) {
            appendInlineToken(result, InlineKind.InlineSpanClose, tokenStart, tokenStart + 1);
          }
          else if (
            claim === FrameClaim.Raw ||
            claim === FrameClaim.Link ||
            claim === FrameClaim.Reference
          ) {
            const image = isImageFrame(tokens, frames, rawFrame);
            if (literalDepth === 0 || image) {
              appendResolvedDelimiterToken(result, tokens, tokenIndex, replacements);
            }
          }
          else if (claim === FrameClaim.Consumed) {
            // A closer beyond the consumed tail becomes raw again, while an enclosing
            // component link label still suppresses its matched normal bracket.
            if (literalDepth === 0 || isImageFrame(tokens, frames, rawFrame)) {
              appendResolvedDelimiterToken(result, tokens, tokenIndex, replacements);
            }
          }
        }
        else {
          appendResolvedDelimiterToken(result, tokens, tokenIndex, replacements);
        }
      }

      if (
        rawFrame >= 0 &&
        (frameClaim(frames, rawFrame) === FrameClaim.Component ||
          frameClaim(frames, rawFrame) === FrameClaim.Span) &&
        frames[rawFrame + FrameSlot.State] & FrameFlag.InLinkLabel
      ) {
        literalDepth--;
      }
      continue;
    }

    if (!skipping) {
      appendResolvedDelimiterToken(result, tokens, tokenIndex, replacements);
    }
  }
  return result;
}

export function compileInlineProgram(options: InlineProgramOptions): InlineResolverCompiler {
  return (delimiterConfigs) => {
    const delimiterByKind = compileDelimiterConfigs(delimiterConfigs);
    return (source, tokens, context) => {
      const frames = analyzeBrackets(
        source,
        tokens,
        delimiterByKind,
        context,
        options,
      );
      const discovery = frames[0];
      if (discovery & Discovery.Bracket) {
        resolveReferences(source, tokens, frames as number[], context);
      }
      let replacements = noDelimiterReplacements;
      if (discovery & Discovery.Delimiter) {
        const runs = assignDelimiterScopes(
          source,
          tokens,
          frames,
          delimiterByKind,
        );
        if (runs) {
          replacements = resolveDelimiterMatches(runs);
        }
      }
      return hasBracketRewrite(frames) || replacements.length > 0
        ? emitResolvedTokens(tokens, frames, replacements)
        : tokens;
    };
  };
}
