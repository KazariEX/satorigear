import { Character } from "../constants/character.ts";
import { InlineKind, InlineRole } from "../constants/inline.ts";
import {
  appendResolvedRawToken,
  compileDelimiterConfigs,
  type DelimiterConfig,
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
  InlineTokenField,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
} from "../inline/tokens.ts";
import { emptyArray } from "../primitives.ts";
import { attributesEnd } from "./features/attributes/shared.ts";
import { footnoteLabelAt } from "./features/footnote/shared.ts";
import { isMarkdownWhitespace, normalizeIdentifier } from "./utils.ts";
import type { DefinitionLookup } from "../block/tokens.ts";

interface InlineResolverOptions {
  component: boolean;
  footnote: boolean;
}

export type InlineResolver = (
  source: string,
  tokens: InlineTokenStream,
  definitions: DefinitionLookup,
) => InlineTokenStream;

export type InlineResolverFactory = (delimiters: readonly DelimiterConfig[]) => InlineResolver;

interface BracketFrame {
  open: number;
  parent: BracketFrame | undefined;
  next: BracketFrame | undefined;
  state: number;
  candidateStart: number;
  delimiterBottom: DelimiterRun | undefined;
  logicalParent: BracketFrame | undefined;
  // Concrete output boundaries; raw kinds retain lexer behavior and None consumes syntax.
  openingKind: InlineKind;
  openingEnd: number;
  // The logical opener may later be consumed; retain the raw closer's decision.
  closingKind: InlineKind;
  closingEnd: number;
}

const enum FrameClaim {
  Raw,
  // Feature boundaries stay contiguous for close-path range checks.
  Footnote,
  Component,
  Span,
  AttributedSpan,
  // Claims are exclusive low-bit discriminants; flags occupy the higher bits.
  Mask = 7,
}

const enum FrameFlag {
  Image = 8,
  InLinkLabel = 16,
}

// Each frame keeps its syntax identity while analysis, pairing, and emission
// establish their own links and boundaries without changing a field's meaning.

function rewriteLinkCandidates(candidates: BracketFrame[], start: number): void {
  let write = start;
  for (let index = start; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (candidate.state === FrameClaim.Span) {
      candidate.state = FrameClaim.Raw;
    }
    else {
      candidate.state |= FrameFlag.InLinkLabel;
      candidates[write++] = candidate;
    }
  }
  candidates.length = write;
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
  start: number,
  end: number,
): BracketFrame | undefined {
  let first: BracketFrame | undefined;
  let last: BracketFrame | undefined;
  let candidates: BracketFrame[] | undefined;
  let stackTop: BracketFrame | undefined;
  for (let tokenIndex = start; tokenIndex < end; tokenIndex++) {
    const kind = inlineTokenKind(tokens, tokenIndex);
    if (kind >= InlineKind.ImageOpen && kind <= InlineKind.BracketOpen) {
      const frame: BracketFrame = {
        open: tokenIndex,
        parent: stackTop,
        next: void 0,
        state: kind === InlineKind.ImageOpen ? FrameFlag.Image : FrameClaim.Raw,
        candidateStart: candidates?.length ?? 0,
        delimiterBottom: void 0,
        logicalParent: void 0,
        openingKind: kind,
        openingEnd: inlineTokenEnd(tokens, tokenIndex),
        closingKind: InlineKind.None,
        closingEnd: 0,
      };
      if (last) {
        last.next = frame;
      }
      else {
        first = frame;
      }
      last = frame;
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
    frame.closingKind = kind;
    frame.closingEnd = inlineTokenEnd(tokens, tokenIndex);
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
        frame.openingEnd = frame.closingEnd;
        if (candidates) {
          candidates.length = frame.candidateStart;
        }
        continue;
      }
    }

    if (!options.component || image) {
      continue;
    }
    if (kind === InlineKind.LinkTail && candidates) {
      rewriteLinkCandidates(candidates, frame.candidateStart);
    }
    const openToken = frame.open;
    const componentToken = openToken - 1;
    if (
      componentToken >= 0 &&
      inlineTokenKind(tokens, componentToken) === InlineKind.InlineComponent &&
      inlineTokenEnd(tokens, componentToken) === inlineTokenStart(tokens, openToken)
    ) {
      frame.state = FrameClaim.Component;
      // Without an enclosing bracket, no later raw link can claim this candidate.
      if (stackTop) {
        candidates ??= [];
        candidates.push(frame);
      }
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
    if (stackTop) {
      candidates ??= [];
      candidates.push(frame);
    }
  }
  return first;
}

function consumeFrame(frame: BracketFrame, end: number): void {
  frame.state = FrameClaim.Raw;
  frame.openingKind = InlineKind.None;
  frame.openingEnd = end;
}

function resolvePairedSyntax(
  source: string,
  tokens: InlineTokenStream,
  nextFrame: BracketFrame | undefined,
  definitions: DefinitionLookup,
  delimiterByKind: ReturnType<typeof compileDelimiterConfigs>,
  start: number,
  end: number,
): readonly DelimiterReplacement[][] {
  // An empty definition table makes every non-resource bracket candidate literal.
  const hasDefinitions = nextFrame !== void 0 && definitions.hasDefinitions();
  // Frames retain the last run outside their scope; closing detaches only its suffix.
  let firstRun: DelimiterRun | undefined;
  let lastRun: DelimiterRun | undefined;
  let replacements: DelimiterReplacement[][] | undefined;
  let rawTop: BracketFrame | undefined;
  let logicalTop: BracketFrame | undefined;
  let consumedEnd = -1;
  let consumeFrames = false;
  let inactiveBefore = 0;
  let lastVisibleOpener = -1;
  let literalDepth = 0;

  for (let tokenIndex = start; tokenIndex < end; tokenIndex++) {
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
        run.previous = lastRun;
        if (lastRun) {
          lastRun.next = run;
        }
        else {
          firstRun = run;
        }
        lastRun = run;
      }
    }

    if (kind >= InlineKind.ImageOpen && kind <= InlineKind.BracketOpen) {
      const frame = nextFrame!;
      nextFrame = frame.next;
      rawTop = frame;
      if (consuming) {
        if (consumeFrames) {
          consumeFrame(frame, consumedEnd);
        }
        continue;
      }
      frame.delimiterBottom = lastRun;

      const state = frame.state;
      const claim = state & FrameClaim.Mask;
      if (claim === FrameClaim.Footnote) {
        consumedEnd = frame.openingEnd;
        frame.openingKind = InlineKind.FootnoteReference;
        frame.openingEnd = consumedEnd;
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
        frame.openingKind = InlineKind.None;
        frame.closingKind = InlineKind.None;
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
        consumeFrame(rawFrame, inlineTokenEnd(tokens, tokenIndex));
      }
      continue;
    }

    const rawState = rawFrame === void 0 ? FrameClaim.Raw : rawFrame.state;
    const rawClaim = rawState & FrameClaim.Mask;
    let scopeFrame = rawClaim >= FrameClaim.Footnote && rawClaim <= FrameClaim.AttributedSpan
      ? rawFrame
      : void 0;
    const visible = scopeFrame === void 0 && (
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
            const openingKind = (reference ? InlineKind.ReferenceOpen : InlineKind.LinkOpen) + (image ? 2 : 0);
            frame.openingKind = openingKind;
            rawFrame!.closingKind = openingKind + 1;
            rawFrame!.closingEnd = closeEnd;
            scopeFrame = frame;
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

    // Pairing lowers each feature once. The emitter only reads finalized token boundaries.
    if (rawClaim === FrameClaim.Component) {
      const openEnd = inlineTokenEnd(tokens, rawFrame!.open);
      const nonempty = openEnd < tokenStart;
      rawFrame!.openingKind = nonempty ? InlineKind.InlineComponentOpen : InlineKind.None;
      rawFrame!.closingKind = nonempty ? InlineKind.InlineComponentClose : InlineKind.None;
      rawFrame!.closingEnd = tokenStart + 1;
    }
    else if (rawClaim >= FrameClaim.Span && rawClaim <= FrameClaim.AttributedSpan) {
      rawFrame!.openingKind = InlineKind.InlineSpanOpen;
      rawFrame!.closingKind = InlineKind.InlineSpanClose;
      rawFrame!.closingEnd = tokenStart + 1;
    }

    if (rawState & FrameFlag.InLinkLabel) {
      literalDepth--;
    }
    if (scopeFrame && lastRun !== scopeFrame.delimiterBottom) {
      const bottom = scopeFrame.delimiterBottom;
      const first = bottom ? bottom.next! : firstRun!;
      if (bottom) {
        bottom.next = void 0;
      }
      else {
        firstRun = void 0;
      }
      first.previous = void 0;
      replacements = resolveDelimiterScope(first, replacements);
      lastRun = bottom;
    }
  }
  if (firstRun) {
    replacements = resolveDelimiterScope(firstRun, replacements);
  }
  return replacements ?? emptyArray;
}

function emitResolvedTokens(
  tokens: InlineTokenStream,
  nextFrame: BracketFrame | undefined,
  replacements: readonly DelimiterReplacement[][],
  start: number,
  end: number,
): InlineTokenStream {
  const result = start ? tokens.slice(0, start * InlineTokenField.Stride) : [];
  let rawTop: BracketFrame | undefined;
  let skipEnd = -1;
  for (let index = start; index < end; index++) {
    const kind = inlineTokenKind(tokens, index);
    const tokenStart = inlineTokenStart(tokens, index);
    let outputKind = kind;
    let outputEnd = inlineTokenEnd(tokens, index);
    if (kind >= InlineKind.ImageOpen && kind <= InlineKind.BracketOpen) {
      const frame = nextFrame!;
      nextFrame = frame.next;
      rawTop = frame;
      outputKind = frame.openingKind;
      outputEnd = frame.openingEnd;
    }
    else if (kind === InlineKind.LinkTail || kind === InlineKind.BracketClose) {
      const frame = rawTop;
      rawTop = frame?.parent;
      if (frame) {
        outputKind = frame.closingKind;
        outputEnd = frame.closingEnd;
      }
    }
    // Track raw nesting even while a semantic replacement consumes source tokens.
    if (tokenStart < skipEnd) {
      continue;
    }
    if (outputKind === InlineKind.InlineComponentOpen) {
      // A nonempty label promotes its adjacent leaf instead of emitting `[`.
      const field = result.length - InlineTokenField.Stride;
      result[field | InlineTokenField.Kind] = outputKind;
      result[field | InlineTokenField.End] = outputEnd;
    }
    else if (outputKind >= InlineRole.Text) {
      const sourceStart = tokenStart + (
        outputKind === InlineKind.FootnoteReference && kind === InlineKind.ImageOpen ? 1 : 0
      );
      appendInlineToken(result, outputKind, sourceStart, outputEnd, inlineTokenData(tokens, index));
      skipEnd = outputEnd;
    }
    else if (outputKind === InlineKind.None) {
      skipEnd = outputEnd;
    }
    else {
      appendResolvedRawToken(result, tokens, index, replacements);
    }
  }
  return result;
}

export function compileInlineResolver(options: InlineResolverOptions): InlineResolverFactory {
  return (delimiterConfigs) => {
    const delimiterByKind = compileDelimiterConfigs(delimiterConfigs);
    return (source, tokens, definitions) => {
      // The first raw candidate starts structural resolution; its semantic prefix is complete.
      let start = 0;
      const end = inlineTokenCount(tokens);
      while (start < end && inlineTokenKind(tokens, start) >= InlineRole.Text) {
        start++;
      }
      if (start === end) {
        return tokens;
      }
      // A lone opener and a validated resource tail form a complete pair.
      // There are no nested brackets, delimiters or component prefixes to resolve.
      if (start === 0 && end === 2 && inlineTokenKind(tokens, 1) === InlineKind.LinkTail) {
        const opener = inlineTokenKind(tokens, 0);
        if (opener === InlineKind.BracketOpen || opener === InlineKind.ImageOpen) {
          const kind = opener === InlineKind.ImageOpen ? InlineKind.ImageLinkOpen : InlineKind.LinkOpen;
          const result = tokens.slice();
          result[InlineTokenField.Kind] = kind;
          result[InlineTokenField.Stride | InlineTokenField.Kind] = kind + 1;
          return result;
        }
      }
      const frames = analyzeBrackets(source, tokens, definitions, options, start, end);
      const replacements = resolvePairedSyntax(source, tokens, frames, definitions, delimiterByKind, start, end);
      return emitResolvedTokens(tokens, frames, replacements, start, end);
    };
  };
}
