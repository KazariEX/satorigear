import { Character } from "../constants/character.ts";
import {
  appendInlineToken,
  copyInlineToken,
  inlineTokenCount,
  inlineTokenEnd,
  inlineTokenFlags,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
} from "./tokens.ts";
import type { InlineKind } from "../constants/inline.ts";

type DelimiterResolver = (
  source: string,
  tokens: InlineTokenStream,
) => InlineTokenStream;

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
  allowIntraword?: boolean;
  matchWholeRun?: boolean;
  ruleOfThree?: boolean;
  index: number;
}

interface DelimiterRun {
  tokenIndex: number;
  offset: number;
  config: CompiledDelimiterConfig;
  length: number;
  start: number;
  remaining: number;
  canOpen: boolean;
  canClose: boolean;
  scope: number;
  previous: number;
  next: number;
}

interface Replacement {
  offset: number;
  end: number;
  kind: number;
}

const enum Flanking {
  Open = 1,
  Close = 2,
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
  if (config.allowIntraword !== false) {
    return (left ? Flanking.Open : 0) | (right ? Flanking.Close : 0);
  }
  const canOpen = left && (!right || beforePunctuation);
  const canClose = right && (!left || afterPunctuation);
  return (canOpen ? Flanking.Open : 0) | (canClose ? Flanking.Close : 0);
}

function canPair(opener: DelimiterRun, closer: DelimiterRun): boolean {
  if (!opener.canOpen || !closer.canClose) {
    return false;
  }
  if (closer.config.matchWholeRun && opener.length !== closer.length) {
    return false;
  }
  if (!closer.config.ruleOfThree || (!opener.canClose && !closer.canOpen)) {
    return true;
  }
  const sum = opener.length + closer.length;
  return sum % 3 !== 0 || (opener.length % 3 === 0 && closer.length % 3 === 0);
}

function appendFragment(
  result: number[],
  tokens: InlineTokenStream,
  tokenIndex: number,
  start: number,
  end: number,
  kind: number,
): void {
  const flags = start === inlineTokenStart(tokens, tokenIndex) ? inlineTokenFlags(tokens, tokenIndex) : 0;
  appendInlineToken(result, kind, start, end, flags);
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

function addReplacement(replacements: Replacement[][], tokenIndex: number, replacement: Replacement): void {
  const tokenReplacements = replacements[tokenIndex];
  if (tokenReplacements) {
    tokenReplacements.push(replacement);
  }
  else {
    replacements[tokenIndex] = [replacement];
  }
}

function matchDelimiterRuns(runs: DelimiterRun[], first: number, replacements: Replacement[][]): void {
  const openersBottom: number[] = [];
  let current = first;
  while (current >= 0) {
    const closer = runs[current];
    const next = closer.next;
    if (!closer.canClose || closer.remaining === 0) {
      current = next;
      continue;
    }
    const bottomSlot = closer.config.index * 6 + (closer.canOpen ? 3 : 0) + closer.length % 3;
    const bottom = openersBottom[bottomSlot] ?? -1;
    let openerIndex = closer.previous;
    while (openerIndex >= 0 && openerIndex !== bottom) {
      const opener = runs[openerIndex];
      if (opener.config === closer.config && opener.remaining > 0 && canPair(opener, closer)) {
        break;
      }
      openerIndex = opener.previous;
    }
    if (openerIndex < 0 || openerIndex === bottom) {
      openersBottom[bottomSlot] = closer.previous;
      if (!closer.canOpen) {
        unlinkRun(runs, current);
      }
      current = next;
      continue;
    }

    const opener = runs[openerIndex];
    const use = opener.remaining >= 2 && closer.remaining >= 2 && closer.config.double ? 2 : 1;
    const openEnd = opener.offset + opener.start + opener.remaining;
    const openStart = openEnd - use;
    const closeStart = closer.offset + closer.start;
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

function resolveDelimiterRuns(
  source: string,
  tokens: InlineTokenStream,
  configByKind: readonly (CompiledDelimiterConfig | undefined)[],
  isolationCloseByOpen: readonly (number | undefined)[],
): InlineTokenStream {
  const runs: DelimiterRun[] = [];
  const isolationClosers: number[] = [];
  const isolationScopes: number[] = [];
  let nextIsolationScope = 0;
  const count = inlineTokenCount(tokens);
  for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
    const kind = inlineTokenKind(tokens, tokenIndex);
    const isolationIndex = isolationClosers.length - 1;
    if (isolationIndex >= 0 && isolationClosers[isolationIndex] === kind) {
      isolationClosers.pop();
      isolationScopes.pop();
      continue;
    }
    const isolationClose = isolationCloseByOpen[kind];
    if (isolationClose !== void 0) {
      isolationClosers.push(isolationClose);
      isolationScopes.push(nextIsolationScope++);
      continue;
    }
    const config = configByKind[kind];
    if (!config) {
      continue;
    }
    const offset = inlineTokenStart(tokens, tokenIndex);
    const end = inlineTokenEnd(tokens, tokenIndex);
    const length = end - offset;
    if (
      config.matchWholeRun &&
      (length > 2 || (length === 1 ? !config.single : !config.double))
    ) {
      continue;
    }
    const flags = flanking(source, offset, end, config);
    runs.push({
      tokenIndex,
      offset,
      config,
      length,
      start: 0,
      remaining: length,
      scope: isolationScopes[isolationScopes.length - 1] ?? -1,
      previous: -1,
      next: -1,
      canOpen: Boolean(flags & Flanking.Open),
      canClose: Boolean(flags & Flanking.Close),
    });
  }
  if (runs.length === 0) {
    return tokens;
  }

  const scopeFirst: number[] = [];
  const scopeLast: number[] = [];
  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const run = runs[runIndex];
    const scope = run.scope + 1;
    const previous = scopeLast[scope];
    if (previous !== void 0) {
      run.previous = previous;
      runs[previous].next = runIndex;
    }
    else {
      scopeFirst[scope] = runIndex;
    }
    scopeLast[scope] = runIndex;
  }

  const replacements: Replacement[][] = [];
  for (const first of scopeFirst) {
    if (first !== void 0) {
      matchDelimiterRuns(runs, first, replacements);
    }
  }

  if (replacements.length === 0) {
    return tokens;
  }

  const result: number[] = [];
  for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
    const kind = inlineTokenKind(tokens, tokenIndex);
    const config = configByKind[kind];
    if (!config) {
      copyInlineToken(result, tokens, tokenIndex);
      continue;
    }
    const matched = replacements[tokenIndex];
    if (matched && matched.length > 1) {
      matched.sort((left, right) => left.offset - right.offset);
    }
    let offset = inlineTokenStart(tokens, tokenIndex);
    if (matched) {
      for (const replacement of matched) {
        if (replacement.offset > offset) {
          appendFragment(result, tokens, tokenIndex, offset, replacement.offset, kind);
        }
        appendFragment(result, tokens, tokenIndex, replacement.offset, replacement.end, replacement.kind);
        offset = replacement.end;
      }
    }
    const end = inlineTokenEnd(tokens, tokenIndex);
    if (offset < end) {
      appendFragment(result, tokens, tokenIndex, offset, end, kind);
    }
  }
  return result;
}

export function createDelimiterResolver(
  delimiterConfigs: readonly DelimiterConfig[],
  isolationCloseByOpen: readonly (number | undefined)[],
): DelimiterResolver {
  const delimiterByKind: (CompiledDelimiterConfig | undefined)[] = [];
  delimiterConfigs.forEach((config, index) => {
    delimiterByKind[config.token] = {
      single: config.single
        ? { open: config.single.open, close: config.single.close }
        : void 0,
      double: config.double
        ? { open: config.double.open, close: config.double.close }
        : void 0,
      allowIntraword: config.allowIntraword,
      matchWholeRun: config.pairing.kind === "whole" ? true : void 0,
      ruleOfThree: config.pairing.kind === "partial" ? config.pairing.ruleOfThree : void 0,
      index,
    };
  });
  const delimiterKinds: boolean[] = [];
  for (const config of delimiterConfigs) {
    delimiterKinds[config.token] = true;
  }
  return (source, tokens) => {
    const count = inlineTokenCount(tokens);
    for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
      if (delimiterKinds[inlineTokenKind(tokens, tokenIndex)]) {
        return resolveDelimiterRuns(source, tokens, delimiterByKind, isolationCloseByOpen);
      }
    }
    return tokens;
  };
}
