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

export interface DelimiterConfig {
  token: InlineKind;
  single?: { open: InlineKind; close: InlineKind };
  double?: { open: InlineKind; close: InlineKind };
  pairing:
    | { kind: "partial"; ruleOfThree?: boolean }
    | { kind: "whole" };
  allowIntraword?: boolean;
}

interface CompiledDelimiterConfig {
  single?: { open: number; close: number };
  double?: { open: number; close: number };
  flags: number;
  index: number;
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

interface DelimiterReplacement {
  offset: number;
  end: number;
  kind: number;
}

// Open/Close occupy the low bits; the high bits store the original run length modulo 3.
const enum DelimiterRunState {
  Open = 1,
  Close = 2,
  // eslint-disable-next-line ts/prefer-literal-enum-member
  FlankingMask = Open | Close,
  LengthModuloMask = 12,
}

const enum DelimiterFlag {
  Intraword = 1,
  MatchWholeRun = 2,
  RuleOfThree = 4,
}

const whitespace = /\s/u;
const punctuation = /[\p{P}\p{S}]/u;

function characterBefore(source: string, offset: number): string {
  if (offset <= 0) {
    return "\n";
  }
  const trailing = source.charCodeAt(offset - 1);
  if (trailing >= Character.LowSurrogateStart && trailing <= Character.LowSurrogateEnd && offset > 1) {
    const leading = source.charCodeAt(offset - 2);
    if (leading >= Character.HighSurrogateStart && leading <= Character.HighSurrogateEnd) {
      return source.slice(offset - 2, offset);
    }
  }
  return source[offset - 1];
}

function characterAfter(source: string, offset: number): string {
  return offset < source.length ? String.fromCodePoint(source.codePointAt(offset)!) : "\n";
}

// A bit mask avoids allocating a { canOpen, canClose } result for every delimiter run.
function flanking(source: string, start: number, end: number, config: CompiledDelimiterConfig): number {
  const before = characterBefore(source, start);
  const after = characterAfter(source, end);
  const beforeWhitespace = whitespace.test(before);
  const afterWhitespace = whitespace.test(after);
  const beforePunctuation = punctuation.test(before);
  const afterPunctuation = punctuation.test(after);
  const left = !afterWhitespace && (!afterPunctuation || beforeWhitespace || beforePunctuation);
  const right = !beforeWhitespace && (!beforePunctuation || afterWhitespace || afterPunctuation);
  if (config.flags & DelimiterFlag.Intraword) {
    return (left ? DelimiterRunState.Open : 0) | (right ? DelimiterRunState.Close : 0);
  }
  const canOpen = left && (!right || beforePunctuation);
  const canClose = right && (!left || afterPunctuation);
  return (canOpen ? DelimiterRunState.Open : 0) | (canClose ? DelimiterRunState.Close : 0);
}

function canPair(opener: DelimiterRun, closer: DelimiterRun): boolean {
  if (!(opener.state & DelimiterRunState.Open)) {
    return false;
  }
  if (
    closer.config.flags & DelimiterFlag.MatchWholeRun &&
    (opener.state & DelimiterRunState.LengthModuloMask) !== (closer.state & DelimiterRunState.LengthModuloMask)
  ) {
    return false;
  }
  if (
    !(closer.config.flags & DelimiterFlag.RuleOfThree) ||
    !(opener.state & DelimiterRunState.Close) && !(closer.state & DelimiterRunState.Open)
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

function addReplacement(
  replacements: DelimiterReplacement[][],
  tokenIndex: number,
  replacement: DelimiterReplacement,
): void {
  const tokenReplacements = replacements[tokenIndex];
  if (tokenReplacements) {
    tokenReplacements.push(replacement);
  }
  else {
    replacements[tokenIndex] = [replacement];
  }
}

function matchDelimiterRuns(
  runs: DelimiterRun[],
  first: number,
  replacements: DelimiterReplacement[][],
): void {
  const openersBottom: number[] = [];
  let current = first;
  // Matching unlinks exhausted runs, so every active run has remaining source.
  while (current >= 0) {
    const closer = runs[current];
    const next = closer.next;
    if (!(closer.state & DelimiterRunState.Close)) {
      if ((closer.state & DelimiterRunState.FlankingMask) === 0) {
        // Inert runs cannot pair and only lengthen later opener searches.
        unlinkRun(runs, current);
      }
      current = next;
      continue;
    }
    const bottomSlot = closer.config.index * 6 +
      (closer.state & DelimiterRunState.Open ? 3 : 0) +
      (closer.state >> 2);
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
      if (!(closer.state & DelimiterRunState.Open)) {
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
    addReplacement(replacements, opener.tokenIndex, { offset: openStart, end: openEnd, kind: pair.open });
    addReplacement(replacements, closer.tokenIndex, { offset: closeStart, end: closeEnd, kind: pair.close });
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
}

export function delimiterRunAt(
  source: string,
  tokens: InlineTokenStream,
  tokenIndex: number,
  configByKind: readonly (CompiledDelimiterConfig | undefined)[],
): DelimiterRun | undefined {
  const kind = inlineTokenKind(tokens, tokenIndex);
  const config = configByKind[kind];
  if (!config) {
    return;
  }
  const offset = inlineTokenStart(tokens, tokenIndex);
  const end = inlineTokenEnd(tokens, tokenIndex);
  const length = end - offset;
  if (
    config.flags & DelimiterFlag.MatchWholeRun && (
      length > 2 || (length === 1 ? !config.single : !config.double)
    )
  ) {
    return;
  }
  const delimiterFlanking = flanking(source, offset, end, config);
  if (config.flags & DelimiterFlag.Intraword || delimiterFlanking !== 0) {
    return {
      tokenIndex,
      config,
      start: offset,
      remaining: length,
      previous: -1,
      next: -1,
      state: delimiterFlanking | ((length % 3) << 2),
    };
  }
}

export function resolveDelimiterMatches(runs: DelimiterRun[]): DelimiterReplacement[][] {
  const replacements: DelimiterReplacement[][] = [];
  // Walk backwards so unlinking a head cannot make its successor look like a new scope head later.
  for (let runIndex = runs.length - 1; runIndex >= 0; runIndex--) {
    if (runs[runIndex].previous < 0) {
      matchDelimiterRuns(runs, runIndex, replacements);
    }
  }
  return replacements;
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
      flags:
        (config.allowIntraword !== false ? DelimiterFlag.Intraword : 0) |
        (config.pairing.kind === "whole" ? DelimiterFlag.MatchWholeRun : 0) |
        (config.pairing.kind === "partial" && config.pairing.ruleOfThree ? DelimiterFlag.RuleOfThree : 0),
      index,
    };
  });
  return delimiterByKind;
}
