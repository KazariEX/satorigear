import { Character } from "../constants/character.ts";
import {
  appendInlineToken,
  copyInlineToken,
  inlineTokenEnd,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
} from "./tokens.ts";
import type { InlineKind } from "../constants/inline.ts";

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

export interface DelimiterRun {
  tokenIndex: number;
  config: CompiledDelimiterConfig;
  start: number;
  remaining: number;
  previous: number;
  next: number;
  state: number;
}

export interface DelimiterReplacement {
  offset: number;
  end: number;
  kind: number;
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

const whitespace = /\s/u;
const punctuation = /[\p{P}\p{S}]/u;

const enum DelimiterCharacterClass {
  Whitespace = 1,
  Punctuation = 2,
}

function codePointBefore(source: string, offset: number): number {
  if (offset <= 0) {
    return Character.LineFeed;
  }
  const trailing = source.charCodeAt(offset - 1);
  if (trailing >= Character.LowSurrogateStart && trailing <= Character.LowSurrogateEnd && offset > 1) {
    const leading = source.charCodeAt(offset - 2);
    if (leading >= Character.HighSurrogateStart && leading <= Character.HighSurrogateEnd) {
      return source.codePointAt(offset - 2)!;
    }
  }
  return trailing;
}

// Delimiter boundaries are predominantly ASCII. Keep this classification local to the hot
// flanking path; non-ASCII code points retain the complete Unicode whitespace/punctuation rules.
function delimiterCharacterClass(code: number): number {
  if (code <= 0x7F) {
    if (
      code === Character.Space ||
      code >= Character.CharacterTabulation && code <= Character.CarriageReturn
    ) {
      return DelimiterCharacterClass.Whitespace;
    }
    return (
      code >= Character.ExclamationMark && code <= Character.Solidus ||
      code >= Character.Colon && code <= Character.CommercialAt ||
      code >= Character.LeftSquareBracket && code <= Character.GraveAccent ||
      code >= Character.LeftCurlyBracket && code <= Character.Tilde
    )
      ? DelimiterCharacterClass.Punctuation
      : 0;
  }
  const character = String.fromCodePoint(code);
  return (
    whitespace.test(character) ? DelimiterCharacterClass.Whitespace
      : punctuation.test(character) ? DelimiterCharacterClass.Punctuation
        : 0
  );
}

// A bit mask avoids allocating a { canOpen, canClose } result for every delimiter run.
function flanking(source: string, start: number, end: number, config: CompiledDelimiterConfig): number {
  const before = delimiterCharacterClass(codePointBefore(source, start));
  const after = delimiterCharacterClass(source.codePointAt(end) ?? Character.LineFeed);
  // Other characters always flank; punctuation needs whitespace or punctuation on the opposite side.
  const left = after === 0 || (
    after === DelimiterCharacterClass.Punctuation && before !== 0
  );
  const right = before === 0 || (
    before === DelimiterCharacterClass.Punctuation && after !== 0
  );
  if (config.bits & DelimiterConfigFlag.AllowIntraword) {
    return (left ? DelimiterRunState.CanOpen : 0) | (right ? DelimiterRunState.CanClose : 0);
  }
  const canOpen = left && (!right || before === DelimiterCharacterClass.Punctuation);
  const canClose = right && (!left || after === DelimiterCharacterClass.Punctuation);
  return (canOpen ? DelimiterRunState.CanOpen : 0) | (canClose ? DelimiterRunState.CanClose : 0);
}

function canPair(opener: DelimiterRun, closer: DelimiterRun): boolean {
  if (!(opener.state & DelimiterRunState.CanOpen)) {
    return false;
  }
  if (
    closer.config.bits & DelimiterConfigFlag.MatchWholeRun &&
    (opener.state & DelimiterRunState.LengthModuloMask) !==
    (closer.state & DelimiterRunState.LengthModuloMask)
  ) {
    return false;
  }
  if (
    !(closer.config.bits & DelimiterConfigFlag.RuleOfThree) || (
      !(opener.state & DelimiterRunState.CanClose) &&
      !(closer.state & DelimiterRunState.CanOpen)
    )
  ) {
    return true;
  }
  // Encoded modulo 1 and 2 are the only invalid rule-of-three sum.
  return (
    (opener.state & DelimiterRunState.LengthModuloMask) +
    (closer.state & DelimiterRunState.LengthModuloMask) !== DelimiterRunState.LengthModuloMask
  );
}

function unlinkRun(runs: DelimiterRun[], runIndex: number): void {
  const run = runs[runIndex];
  if (run.previous >= 0) {
    runs[run.previous].next = run.next;
  }
  if (run.next >= 0) {
    runs[run.next].previous = run.previous;
  }
}

export function resolveDelimiterScope(
  runs: DelimiterRun[],
  first: number,
  replacements: DelimiterReplacement[][] = [],
): DelimiterReplacement[][] {
  const openersBottom: number[] = [];
  let current = first;
  // Matching unlinks exhausted runs, so every active run has remaining source.
  while (current >= 0) {
    const closer = runs[current];
    const next = closer.next;
    if (!(closer.state & DelimiterRunState.CanClose)) {
      current = next;
      continue;
    }
    const bottomSlotBase = closer.config.bits >>> DelimiterConfigLayout.BottomSlotBaseShift;
    // Each config owns two groups of three remainder classes; can-open selects the second group.
    const bottomSlot = bottomSlotBase +
      (closer.state & DelimiterRunState.CanOpen ? DelimiterRunLayout.LengthModuloCount : 0) +
      (closer.state >> DelimiterRunLayout.OriginalLengthModuloShift);
    const bottom = openersBottom[bottomSlot] ?? -1;
    let openerIndex = closer.previous;
    while (openerIndex >= 0 && openerIndex !== bottom) {
      const opener = runs[openerIndex];
      if (opener.config === closer.config && canPair(opener, closer)) {
        break;
      }
      openerIndex = opener.previous;
    }
    if (openerIndex < 0 || openerIndex === bottom) {
      openersBottom[bottomSlot] = closer.previous;
      if (!(closer.state & DelimiterRunState.CanOpen)) {
        unlinkRun(runs, current);
      }
      current = next;
      continue;
    }

    const opener = runs[openerIndex];
    const use = opener.remaining >= 2 && closer.remaining >= 2 && closer.config.double ? 2 : 1;
    const openEnd = opener.start + opener.remaining;
    const openStart = openEnd - use;
    const closeStart = closer.start;
    const closeEnd = closeStart + use;
    // Partial delimiters always define a single replacement; unsupported whole runs were filtered before matching.
    const pair = use === 2 ? closer.config.double! : closer.config.single!;
    (replacements[opener.tokenIndex] ??= []).push({ offset: openStart, end: openEnd, kind: pair.open });
    (replacements[closer.tokenIndex] ??= []).push({ offset: closeStart, end: closeEnd, kind: pair.close });
    opener.remaining -= use;
    closer.start += use;
    closer.remaining -= use;
    opener.next = current;
    closer.previous = openerIndex;
    if (opener.remaining === 0) {
      unlinkRun(runs, openerIndex);
    }
    if (closer.remaining === 0) {
      unlinkRun(runs, current);
      current = next;
    }
  }
  return replacements;
}

export function delimiterRunAt(
  source: string,
  tokens: InlineTokenStream,
  tokenIndex: number,
  config: CompiledDelimiterConfig,
): DelimiterRun | undefined {
  const offset = inlineTokenStart(tokens, tokenIndex);
  const end = inlineTokenEnd(tokens, tokenIndex);
  const length = end - offset;
  if (
    config.bits & DelimiterConfigFlag.MatchWholeRun && (
      length > 2 || (length === 1 ? !config.single : !config.double)
    )
  ) {
    return;
  }
  const delimiterFlanking = flanking(source, offset, end, config);
  if (delimiterFlanking !== 0) {
    return {
      tokenIndex,
      config,
      start: offset,
      remaining: length,
      previous: -1,
      next: -1,
      state: delimiterFlanking | (
        (length % DelimiterRunLayout.LengthModuloCount) << DelimiterRunLayout.OriginalLengthModuloShift
      ),
    };
  }
}

export function appendResolvedDelimiterToken(
  result: number[],
  tokens: InlineTokenStream,
  tokenIndex: number,
  replacements: DelimiterReplacement[][],
): void {
  const matched = replacements[tokenIndex];
  if (!matched) {
    copyInlineToken(result, tokens, tokenIndex);
    return;
  }
  if (matched.length > 1) {
    matched.sort((left, right) => left.offset - right.offset);
  }
  const kind = inlineTokenKind(tokens, tokenIndex);
  let offset = inlineTokenStart(tokens, tokenIndex);
  for (const replacement of matched) {
    if (replacement.offset > offset) {
      appendInlineToken(result, kind, offset, replacement.offset);
    }
    appendInlineToken(result, replacement.kind, replacement.offset, replacement.end);
    offset = replacement.end;
  }
  const end = inlineTokenEnd(tokens, tokenIndex);
  if (offset < end) {
    appendInlineToken(result, kind, offset, end);
  }
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
