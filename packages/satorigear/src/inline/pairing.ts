import { Character } from "../constants/character.ts";
import { emptyArray } from "../primitives.ts";
import {
  appendInlineToken,
  copyInlineToken,
  inlineTokenCount,
  inlineTokenEnd,
  inlineTokenFlags,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
  inlineTokenStride,
} from "./tokens.ts";
import type { SourceSpan } from "../source-view.ts";
import type { InlineKind } from "./kinds.ts";
import type { InlineResolutionContext, InlineTokenTransform } from "./profile.ts";

export interface DelimiterConfig {
  token: InlineKind;
  marker: string;
  single?: { open: InlineKind; close: InlineKind };
  double?: { open: InlineKind; close: InlineKind };
  pairing:
    | { kind: "partial"; ruleOfThree?: boolean }
    | { kind: "whole" };
  allowIntraword?: boolean;
}

export interface PairedTokenConfig {
  opener: InlineKind;
  closer: InlineKind;
  open?: InlineKind;
  close?: InlineKind;
  deactivateEarlier?: readonly InlineKind[];
  isolateDelimiters?: boolean;
  content?: {
    requireNonWhitespace?: boolean;
    maxCharacters?: number;
    forbidTokens?: readonly InlineKind[];
  };
  activate?: (context: PairedTokenActivationContext) => boolean;
  splitUnmatchedCloser?: (tokens: InlineTokenStream, tokenIndex: number) => InlineTokenStream;
}

interface PairedTokenActivationContext {
  source: string;
  tokens: InlineTokenStream;
  openerIndex: number;
  closerIndex: number;
  content: string;
  state: InlineResolutionContext;
}

interface TokenIsolationSpan extends SourceSpan {
  id: number;
}

interface CompiledDelimiterConfig {
  marker: string;
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

interface IndexedPair {
  activate?: (context: PairedTokenActivationContext) => boolean;
  closeKind: number;
  content?: PairedTokenConfig["content"];
  deactivatedKinds: readonly number[];
  forbiddenKinds: readonly number[];
  isolateDelimiters?: boolean;
  openKind: number;
  openerKind: number;
}

interface PairIndex {
  byCloser: readonly (readonly IndexedPair[] | undefined)[];
  openerKinds: readonly boolean[];
  splitByCloser: readonly (PairedTokenConfig["splitUnmatchedCloser"] | undefined)[];
}

interface PairResolution {
  replacements: readonly number[];
  matchedClosers: readonly boolean[];
  delimiterIsolations: TokenIsolationSpan[];
}

const enum Phase {
  Pair = 1,
  Delimiter = 2,
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

function acceptsContent(
  source: string,
  start: number,
  end: number,
  config: NonNullable<PairedTokenConfig["content"]>,
): boolean {
  let hasNonWhitespace = !config.requireNonWhitespace;
  let characters = 0;
  for (let offset = start; offset < end; offset++) {
    if (!hasNonWhitespace && !whitespace.test(source[offset])) {
      hasNonWhitespace = true;
    }
    if (config.maxCharacters !== void 0) {
      const leading = source.charCodeAt(offset);
      if (leading >= Character.HighSurrogateStart && leading <= Character.HighSurrogateEnd && offset + 1 < end) {
        const trailing = source.charCodeAt(offset + 1);
        if (trailing >= Character.LowSurrogateStart && trailing <= Character.LowSurrogateEnd) {
          offset++;
        }
      }
      characters++;
      if (characters > config.maxCharacters) {
        return false;
      }
    }
  }
  return hasNonWhitespace;
}

function indexPairs(configs: readonly PairedTokenConfig[]): PairIndex {
  const byCloser: IndexedPair[][] = [];
  const openerKinds: boolean[] = [];
  const splitByCloser: PairedTokenConfig["splitUnmatchedCloser"][] = [];
  for (const config of configs) {
    const openerKind = config.opener;
    const closerKind = config.closer;
    openerKinds[openerKind] = true;
    const pairs = byCloser[closerKind] ?? [];
    pairs.push({
      activate: config.activate,
      closeKind: config.close ?? closerKind,
      content: config.content,
      deactivatedKinds: config.deactivateEarlier ?? [],
      forbiddenKinds: config.content?.forbidTokens ?? [],
      isolateDelimiters: config.isolateDelimiters,
      openKind: config.open ?? openerKind,
      openerKind,
    });
    byCloser[closerKind] = pairs;
    if (config.splitUnmatchedCloser) {
      splitByCloser[closerKind] = config.splitUnmatchedCloser;
    }
  }
  return { byCloser, openerKinds, splitByCloser };
}

function resolvePairedTokens(
  source: string,
  tokens: InlineTokenStream,
  index: PairIndex,
  state: InlineResolutionContext,
): PairResolution {
  const openerStacks: number[][] = [];
  const inactiveBefore: number[] = [];
  const lastSeen: number[] = [];
  const replacements: number[] = [];
  const matchedClosers: boolean[] = [];
  const delimiterIsolations: TokenIsolationSpan[] = [];

  function resolveCloser(tokenIndex: number, tokenKind: number): void {
    const pairs = index.byCloser[tokenKind];
    if (!pairs) {
      return;
    }

    let openerIndex = -1;
    let pair = pairs[0];
    let openerStack: number[] | undefined;
    for (const candidate of pairs) {
      const candidates = openerStacks[candidate.openerKind];
      if (!candidates || candidates.length === 0) {
        continue;
      }
      const candidateIndex = candidates[candidates.length - 1];
      if (candidateIndex > openerIndex) {
        openerIndex = candidateIndex;
        pair = candidate;
        openerStack = candidates;
      }
    }
    if (!openerStack) {
      return;
    }

    openerStack.pop();
    if (openerIndex + 1 < (inactiveBefore[pair.openerKind] ?? 0)) {
      return;
    }

    const contentStart = inlineTokenEnd(tokens, openerIndex);
    const closerStart = inlineTokenStart(tokens, tokenIndex);
    if (pair.content && !acceptsContent(source, contentStart, closerStart, pair.content)) {
      return;
    }
    for (const forbiddenKind of pair.forbiddenKinds) {
      if ((lastSeen[forbiddenKind] ?? 0) > openerIndex + 1) {
        return;
      }
    }
    if (pair.activate) {
      const content = source.slice(contentStart, closerStart);
      if (!pair.activate({ source, tokens, openerIndex, closerIndex: tokenIndex, content, state })) {
        return;
      }
    }
    // Isolation-only pairs preserve their kinds and should not copy the token stream.
    if (inlineTokenKind(tokens, openerIndex) !== pair.openKind) {
      replacements[openerIndex] = pair.openKind;
    }
    if (tokenKind !== pair.closeKind) {
      replacements[tokenIndex] = pair.closeKind;
    }
    matchedClosers[tokenIndex] = true;

    for (const kind of pair.deactivatedKinds) {
      inactiveBefore[kind] = Math.max(inactiveBefore[kind] ?? 0, openerIndex + 1);
    }
    if (pair.isolateDelimiters) {
      delimiterIsolations.push({ start: contentStart, end: closerStart, id: delimiterIsolations.length });
    }
  }

  const count = inlineTokenCount(tokens);
  for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
    const kind = inlineTokenKind(tokens, tokenIndex);
    if (index.openerKinds[kind]) {
      const stack = openerStacks[kind] ?? [];
      stack.push(tokenIndex);
      openerStacks[kind] = stack;
    }
    resolveCloser(tokenIndex, kind);
    lastSeen[kind] = tokenIndex + 1;
  }

  return { replacements, matchedClosers, delimiterIsolations };
}

function applyPairReplacements(tokens: InlineTokenStream, replacements: readonly number[]): InlineTokenStream {
  if (replacements.length === 0) {
    return tokens;
  }
  const result = tokens.slice();
  for (let tokenIndex = 0; tokenIndex < replacements.length; tokenIndex++) {
    const kind = replacements[tokenIndex];
    if (kind !== void 0) {
      const offset = tokenIndex * inlineTokenStride;
      result[offset] = kind;
    }
  }
  return result;
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

function assignDelimiterScopes(runs: DelimiterRun[], isolations: readonly TokenIsolationSpan[]): void {
  if (isolations.length === 0) {
    return;
  }
  const ordered = [...isolations].sort((left, right) => left.start - right.start || right.end - left.end);
  const active: TokenIsolationSpan[] = [];
  let isolationIndex = 0;
  for (const run of runs) {
    while (isolationIndex < ordered.length && ordered[isolationIndex].start <= run.offset) {
      const isolation = ordered[isolationIndex++];
      while (active.length > 0 && active[active.length - 1].end <= isolation.start) {
        active.pop();
      }
      const parent = active[active.length - 1];
      if (parent && isolation.end > parent.end) {
        throw new Error("Delimiter isolation ranges must be nested or disjoint");
      }
      if (isolation.end > run.offset) {
        active.push(isolation);
      }
    }
    while (active.length > 0 && active[active.length - 1].end <= run.offset) {
      active.pop();
    }
    run.scope = active[active.length - 1]?.id ?? -1;
  }
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
    const openEnd = opener.offset + (opener.start + opener.remaining) * opener.config.marker.length;
    const openStart = openEnd - use * opener.config.marker.length;
    const closeStart = closer.offset + closer.start * closer.config.marker.length;
    const closeEnd = closeStart + use * closer.config.marker.length;
    const pair = use === 2 ? closer.config.double : closer.config.single;
    if (!pair) {
      throw new Error(`Delimiter ${closer.config.marker} has no replacement for a run of ${use}`);
    }
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
  isolations: readonly TokenIsolationSpan[],
): InlineTokenStream {
  const runs: DelimiterRun[] = [];
  const count = inlineTokenCount(tokens);
  for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
    const config = configByKind[inlineTokenKind(tokens, tokenIndex)];
    if (!config) {
      continue;
    }
    const offset = inlineTokenStart(tokens, tokenIndex);
    const end = inlineTokenEnd(tokens, tokenIndex);
    const length = (end - offset) / config.marker.length;
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
      scope: -1,
      previous: -1,
      next: -1,
      canOpen: Boolean(flags & Flanking.Open),
      canClose: Boolean(flags & Flanking.Close),
    });
  }
  if (runs.length === 0) {
    return tokens;
  }

  assignDelimiterScopes(runs, isolations);
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

export function createPairingResolver(
  delimiterConfigs: readonly DelimiterConfig[],
  pairConfigs: readonly PairedTokenConfig[] = [],
): InlineTokenTransform {
  const delimiterByKind: (CompiledDelimiterConfig | undefined)[] = [];
  delimiterConfigs.forEach((config, index) => {
    delimiterByKind[config.token] = {
      marker: config.marker,
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
  const pairIndex = indexPairs(pairConfigs);
  const phasesByKind: number[] = [];
  for (const config of delimiterConfigs) {
    const kind = config.token;
    phasesByKind[kind] |= Phase.Delimiter;
  }
  for (const config of pairConfigs) {
    const openerKind = config.opener;
    const closerKind = config.closer;
    phasesByKind[openerKind] |= Phase.Pair;
    phasesByKind[closerKind] |= Phase.Pair;
  }

  return (source, tokens, state) => {
    const count = inlineTokenCount(tokens);
    let activePhases = 0;
    for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
      const phases = phasesByKind[inlineTokenKind(tokens, tokenIndex)];
      if (phases === void 0) {
        continue;
      }
      activePhases |= phases;
      if (activePhases === (Phase.Pair | Phase.Delimiter)) {
        break;
      }
    }

    if (!(activePhases & Phase.Pair)) {
      return activePhases & Phase.Delimiter
        ? resolveDelimiterRuns(source, tokens, delimiterByKind, emptyArray)
        : tokens;
    }

    let paired = resolvePairedTokens(source, tokens, pairIndex, state);
    let expanded: number[] | undefined;
    for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
      const split = pairIndex.splitByCloser[inlineTokenKind(tokens, tokenIndex)];
      const fragments = split && !paired.matchedClosers[tokenIndex] ? split(tokens, tokenIndex) : void 0;
      if (fragments) {
        if (!expanded) {
          expanded = [];
          for (let prefix = 0; prefix < tokenIndex; prefix++) {
            copyInlineToken(expanded, tokens, prefix);
          }
        }
        for (const value of fragments) {
          expanded.push(value);
        }
      }
      else if (expanded) {
        copyInlineToken(expanded, tokens, tokenIndex);
      }
    }
    if (expanded) {
      // Splitting an unmatched closer changes token boundaries, so pair the expanded stream again.
      paired = resolvePairedTokens(source, expanded, pairIndex, state);
    }
    const resolvedPairs = applyPairReplacements(expanded ?? tokens, paired.replacements);
    return activePhases & Phase.Delimiter
      ? resolveDelimiterRuns(source, resolvedPairs, delimiterByKind, paired.delimiterIsolations)
      : resolvedPairs;
  };
}
