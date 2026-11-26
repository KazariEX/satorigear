import { Character } from "../constants/character.ts";
import { InlineKind, InlineRole } from "../constants/inline.ts";
import { emptyArray } from "../primitives.ts";
import { isAsciiPunctuation, isAsciiWhitespace } from "../profile/utils.ts";
import {
  appendInlineToken,
  inlineTokenCount,
  inlineTokenEnd,
  InlineTokenField,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
} from "./tokens.ts";
import type { SourceSpan } from "../source-view.ts";

interface DelimiterPair {
  open: InlineKind;
  close: InlineKind;
}

interface BaseDelimiterConfig {
  token: InlineKind;
  double?: DelimiterPair;
  allowIntraword?: boolean;
}

export type DelimiterConfig = BaseDelimiterConfig & (
  | {
    single: DelimiterPair;
    pairing: { kind: "partial"; ruleOfThree?: boolean };
  }
  | {
    single?: DelimiterPair;
    pairing: { kind: "whole" };
  }
);

export interface CompiledDelimiterConfig {
  single?: DelimiterPair;
  double?: DelimiterPair;
  bits: number;
}

interface DelimiterRun {
  tokenIndex: number;
  config: CompiledDelimiterConfig;
  start: number;
  remaining: number;
  state: number;
}

interface DelimiterReplacement extends SourceSpan {
  kind: InlineKind;
}

// CanOpen/CanClose occupy the low bits; the high bits store the original run length modulo 3.
const enum DelimiterRunState {
  CanOpen = 1,
  CanClose = 2,
  LengthModuloMask = 12,
}

const enum DelimiterConfigFlag {
  AllowIntraword = 1,
  MatchWholeRun = 2,
  RuleOfThree = 4,
}

// Feature flags occupy the low bits; the openers-bottom slot base follows them.
const enum DelimiterConfigLayout {
  BottomSlotBaseShift = 3,
  BottomSlotsPerConfig = 6,
}

// Runs keep can-open/can-close in the low bits and original length modulo 3 above them.
const enum DelimiterRunLayout {
  OriginalLengthModuloShift = 2,
  LengthModuloCount = 3,
}

const whitespace = /\s/uy;
const punctuation = /[\p{P}\p{S}]/uy;

const enum DelimiterClass {
  Whitespace,
  Punctuation,
  Other,
}

const delimiterClasses = Uint8Array.from({ length: 128 }, (value, code) => (
  isAsciiWhitespace(code) ? DelimiterClass.Whitespace
    : isAsciiPunctuation(code) ? DelimiterClass.Punctuation
      : DelimiterClass.Other
));

function delimiterCharacterClass(source: string, index: number): DelimiterClass {
  if (index < 0 || index >= source.length) {
    return DelimiterClass.Whitespace;
  }
  const code = source.charCodeAt(index);
  if (code <= 0x7F) {
    return delimiterClasses[code];
  }
  // A trailing surrogate belongs to the preceding code point only for a valid pair.
  if (code >= Character.LowSurrogateStart && code <= Character.LowSurrogateEnd) {
    const leading = source.charCodeAt(index - 1);
    if (leading >= Character.HighSurrogateStart && leading <= Character.HighSurrogateEnd) {
      index--;
    }
  }
  if (whitespace.lastIndex = index, whitespace.test(source)) {
    return DelimiterClass.Whitespace;
  }
  if (punctuation.lastIndex = index, punctuation.test(source)) {
    return DelimiterClass.Punctuation;
  }
  return DelimiterClass.Other;
}

function flanking(source: string, start: number, end: number, config: CompiledDelimiterConfig): number {
  const before = delimiterCharacterClass(source, start - 1);
  const after = delimiterCharacterClass(source, end);
  // The higher class is inside the span.
  if (before !== after) {
    return before < after ? DelimiterRunState.CanOpen : DelimiterRunState.CanClose;
  }
  // Equal punctuation admits both directions, as do ordinary characters for intraword delimiters.
  return before === DelimiterClass.Punctuation ||
    before === DelimiterClass.Other && (config.bits & DelimiterConfigFlag.AllowIntraword)
    ? DelimiterRunState.CanOpen | DelimiterRunState.CanClose
    : 0;
}

function canPair(opener: DelimiterRun, closer: DelimiterRun): boolean {
  if (
    closer.config.bits & DelimiterConfigFlag.MatchWholeRun &&
    (opener.state & DelimiterRunState.LengthModuloMask) !==
    (closer.state & DelimiterRunState.LengthModuloMask)
  ) {
    return false;
  }
  if (
    closer.config.bits & DelimiterConfigFlag.RuleOfThree && (
      opener.state & DelimiterRunState.CanClose || closer.state & DelimiterRunState.CanOpen
    )
  ) {
    // Encoded modulo 1 and 2 are the only invalid rule-of-three sum.
    return (
      (opener.state & DelimiterRunState.LengthModuloMask) +
      (closer.state & DelimiterRunState.LengthModuloMask) !== DelimiterRunState.LengthModuloMask
    );
  }
  return true;
}

export class DelimiterStack {
  readonly #replacements: DelimiterReplacement[][] = [];
  readonly #runs: DelimiterRun[] = [];

  add(source: string, tokens: InlineTokenStream, tokenIndex: number, config: CompiledDelimiterConfig): void {
    const offset = inlineTokenStart(tokens, tokenIndex);
    const end = inlineTokenEnd(tokens, tokenIndex);
    const length = end - offset;
    if (
      config.bits & DelimiterConfigFlag.MatchWholeRun && (
        length > 2 || !(length === 1 ? config.single : config.double)
      )
    ) {
      return;
    }
    const delimiterFlanking = flanking(source, offset, end, config);
    if (delimiterFlanking !== 0) {
      this.#runs.push({
        tokenIndex,
        config,
        start: offset,
        remaining: length,
        state: delimiterFlanking | (
          (length % DelimiterRunLayout.LengthModuloCount) << DelimiterRunLayout.OriginalLengthModuloShift
        ),
      });
    }
  }

  close(tokens: number[], afterToken = -1): void {
    const runs = this.#runs;
    const end = runs.length;
    let start = 0;
    // Runs from a closed label form a suffix. Each run is removed when its scope closes.
    if (afterToken >= 0) {
      start = end;
      while (start && runs[start - 1].tokenIndex > afterToken) {
        start--;
      }
    }
    if (start === end) {
      return;
    }
    const openersBottom: number[] = [];
    // Consumed slots in this scope hold unmatched openers in source order.
    let top = start;
    for (let index = start; index < end; index++) {
      const closer = runs[index];
      if (!(closer.state & DelimiterRunState.CanClose)) {
        runs[top++] = closer;
        continue;
      }
      const bottomSlotBase: number = closer.config.bits >>> DelimiterConfigLayout.BottomSlotBaseShift;
      // Each config owns two groups of three remainder classes; can-open selects the second group.
      const bottomSlot = bottomSlotBase +
        (closer.state & DelimiterRunState.CanOpen ? DelimiterRunLayout.LengthModuloCount : 0) +
        (closer.state >> DelimiterRunLayout.OriginalLengthModuloShift);
      // Keep failure bounds in token order because stack slots can be reused.
      const bottom = openersBottom[bottomSlot] ?? 0;
      while (closer.remaining) {
        let candidate = top - 1;
        while (candidate >= start && runs[candidate].tokenIndex >= bottom) {
          const opener = runs[candidate];
          if (opener.config === closer.config && canPair(opener, closer)) {
            break;
          }
          candidate--;
        }
        if (candidate < start || runs[candidate].tokenIndex < bottom) {
          openersBottom[bottomSlot] = closer.tokenIndex;
          if (closer.state & DelimiterRunState.CanOpen) {
            runs[top++] = closer;
          }
          break;
        }
        const opener = runs[candidate];
        const use = opener.remaining >= 2 && closer.remaining >= 2 && closer.config.double ? 2 : 1;
        const openEnd = opener.start + opener.remaining;
        const openStart = openEnd - use;
        const closeStart = closer.start;
        const closeEnd = closeStart + use;
        // Partial delimiters always define a single replacement; unsupported whole runs were filtered before matching.
        const pair = use === 2 ? closer.config.double! : closer.config.single!;
        this.#record(tokens, opener.tokenIndex, openStart, openEnd, pair.open);
        this.#record(tokens, closer.tokenIndex, closeStart, closeEnd, pair.close);
        opener.remaining -= use;
        closer.start += use;
        closer.remaining -= use;
        top = candidate + (opener.remaining ? 1 : 0);
      }
    }
    runs.length = start;
  }

  #record(tokens: number[], index: number, start: number, end: number, kind: InlineKind): void {
    // A boundary covering the whole run fits in the original token record.
    if (start === inlineTokenStart(tokens, index) && end === inlineTokenEnd(tokens, index)) {
      tokens[index * InlineTokenField.Stride | InlineTokenField.Kind] = kind;
      return;
    }
    this.#replacements[index] ??= [];
    this.#replacements[index].push({ start, end, kind });
  }

  emit(tokens: InlineTokenStream): InlineTokenStream {
    return emitResolvedTokens(tokens, this.#replacements);
  }
}

export function emitResolvedTokens(
  tokens: InlineTokenStream,
  replacements: readonly DelimiterReplacement[][] = emptyArray,
): InlineTokenStream {
  let end = inlineTokenCount(tokens);
  let index = 0;
  while (index < end && inlineTokenKind(tokens, index) >= InlineRole.Text) {
    index++;
  }
  if (index === end) {
    return tokens;
  }
  // Past the last partial match, trailing raw markers remain implicit source text.
  const limit = Math.max(index, replacements.length);
  while (end > limit && inlineTokenKind(tokens, end - 1) < InlineRole.Text) {
    end--;
  }
  const result = tokens.slice(0, index * InlineTokenField.Stride);
  for (; index < end; index++) {
    const kind = inlineTokenKind(tokens, index);
    if (kind >= InlineRole.Text) {
      const field = index * InlineTokenField.Stride;
      result.push(
        kind,
        tokens[field + InlineTokenField.Start],
        tokens[field + InlineTokenField.End],
        tokens[field + InlineTokenField.Data],
      );
    }
    else if (kind !== InlineKind.None) {
      const matched = replacements[index];
      let last: DelimiterReplacement | undefined;
      if (matched) {
        // Closing matches arrive in source order, followed by opening matches in reverse.
        let left = 0;
        let right = matched.length;
        while (left < right) {
          last = matched[left].kind & 1 ? matched[left++] : matched[--right];
          appendInlineToken(result, last.kind, last.start, last.end);
        }
      }
      // A decorator may attach to the literal portion left after a marker run.
      if (inlineTokenKind(tokens, index + 1) >= InlineRole.Decorate) {
        const start = last?.end ?? inlineTokenStart(tokens, index);
        const end = inlineTokenEnd(tokens, index);
        if (start < end) {
          appendInlineToken(result, InlineKind.LiteralText, start, end);
        }
      }
    }
  }
  return result;
}

export function compileDelimiterConfigs(
  delimiterConfigs: readonly DelimiterConfig[],
): readonly (CompiledDelimiterConfig | undefined)[] {
  const delimiterByKind: (CompiledDelimiterConfig | undefined)[] = [];
  delimiterConfigs.forEach((config, index) => {
    delimiterByKind[config.token] = {
      single: config.single,
      double: config.double,
      bits:
        ((index * DelimiterConfigLayout.BottomSlotsPerConfig) << DelimiterConfigLayout.BottomSlotBaseShift) |
        (config.allowIntraword !== false ? DelimiterConfigFlag.AllowIntraword : 0) |
        (config.pairing.kind === "whole" ? DelimiterConfigFlag.MatchWholeRun : 0) |
        (config.pairing.kind === "partial" && config.pairing.ruleOfThree ? DelimiterConfigFlag.RuleOfThree : 0),
    };
  });
  return delimiterByKind;
}
