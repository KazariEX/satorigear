import {
  appendInlineToken,
  copyInlineToken,
  inlineKind,
  inlineTokenCount,
  inlineTokenEnd,
  inlineTokenFlags,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
  inlineTokenStride,
} from "./runtime.ts";

export interface DelimiterConfig {
  token: string;
  marker: string;
  fallbackToken: string;
  single?: { open: string; close: string };
  double?: { open: string; close: string };
  pairing:
    | { kind: "partial"; ruleOfThree?: boolean }
    | { kind: "whole" };
  allowIntraword?: boolean;
}

export interface PairedTokenConfig<State = undefined> {
  opener: string;
  closer: string;
  open: string;
  close: string;
  deactivateEarlier?: readonly string[];
  isolateDelimiters?: boolean;
  content?: {
    requireNonWhitespace?: boolean;
    maxCharacters?: number;
    forbidTokens?: readonly string[];
  };
  activate?: (context: PairedTokenActivationContext<State>) => boolean;
  splitUnmatchedCloser?: (tokens: InlineTokenStream, tokenIndex: number) => InlineTokenStream;
}

interface PairedTokenActivationContext<State> {
  source: string;
  tokens: InlineTokenStream;
  openerIndex: number;
  closerIndex: number;
  content: string;
  state: State;
}

interface TokenIsolationRange {
  start: number;
  end: number;
  id: number;
}

interface DelimitedTokenResolver<State> {
  resolve: (source: string, tokens: InlineTokenStream, state: State) => InlineTokenStream;
}

interface CompiledDelimiterConfig {
  marker: string;
  fallbackKind: number;
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

interface IndexedPair<State> {
  activate?: (context: PairedTokenActivationContext<State>) => boolean;
  closeKind: number;
  content?: PairedTokenConfig<State>["content"];
  deactivatedKinds: readonly number[];
  forbiddenKinds: readonly number[];
  isolateDelimiters?: boolean;
  openKind: number;
  openerKind: number;
}

interface PairIndex<State> {
  byCloser: readonly (readonly IndexedPair<State>[] | undefined)[];
  openerKinds: readonly boolean[];
  splitByCloser: readonly (PairedTokenConfig<State>["splitUnmatchedCloser"] | undefined)[];
}

interface PairResolution {
  replacements: readonly number[];
  matchedClosers: readonly boolean[];
  delimiterIsolations: TokenIsolationRange[];
}

const whitespace = /\s/u;
const punctuation = /[\p{P}\p{S}]/u;
const canOpenFlag = 1;
const canCloseFlag = 2;

function characterBefore(source: string, offset: number): string {
  if (offset <= 0) {
    return "\n";
  }
  const trailing = source.charCodeAt(offset - 1);
  if (trailing >= 0xDC00 && trailing <= 0xDFFF && offset > 1) {
    const leading = source.charCodeAt(offset - 2);
    if (leading >= 0xD800 && leading <= 0xDBFF) {
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
    return (left ? canOpenFlag : 0) | (right ? canCloseFlag : 0);
  }
  const canOpen = left && (!right || beforePunctuation);
  const canClose = right && (!left || afterPunctuation);
  return (canOpen ? canOpenFlag : 0) | (canClose ? canCloseFlag : 0);
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
      if (leading >= 0xD800 && leading <= 0xDBFF && offset + 1 < end) {
        const trailing = source.charCodeAt(offset + 1);
        if (trailing >= 0xDC00 && trailing <= 0xDFFF) {
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

function indexPairs<State>(configs: readonly PairedTokenConfig<State>[]): PairIndex<State> {
  const byCloser: IndexedPair<State>[][] = [];
  const openerKinds: boolean[] = [];
  const splitByCloser: PairedTokenConfig<State>["splitUnmatchedCloser"][] = [];
  for (const config of configs) {
    const openerKind = inlineKind(config.opener);
    const closerKind = inlineKind(config.closer);
    openerKinds[openerKind] = true;
    const pairs = byCloser[closerKind] ?? [];
    pairs.push({
      activate: config.activate,
      closeKind: inlineKind(config.close),
      content: config.content,
      deactivatedKinds: config.deactivateEarlier?.map(inlineKind) ?? [],
      forbiddenKinds: config.content?.forbidTokens?.map(inlineKind) ?? [],
      isolateDelimiters: config.isolateDelimiters,
      openKind: inlineKind(config.open),
      openerKind,
    });
    byCloser[closerKind] = pairs;
    if (config.splitUnmatchedCloser) {
      splitByCloser[closerKind] = config.splitUnmatchedCloser;
    }
  }
  return { byCloser, openerKinds, splitByCloser };
}

function resolvePairedTokens<State>(
  source: string,
  tokens: InlineTokenStream,
  index: PairIndex<State>,
  state: State,
): PairResolution {
  const openerStacks: number[][] = [];
  const inactiveBefore: number[] = [];
  const lastSeen: number[] = [];
  const replacements: number[] = [];
  const matchedClosers: boolean[] = [];
  const delimiterIsolations: TokenIsolationRange[] = [];

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
    replacements[openerIndex] = pair.openKind;
    replacements[tokenIndex] = pair.closeKind;
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

function assignDelimiterScopes(runs: DelimiterRun[], isolations: readonly TokenIsolationRange[]): void {
  if (isolations.length === 0) {
    return;
  }
  const ordered = [...isolations].sort((left, right) => left.start - right.start || right.end - left.end);
  const active: TokenIsolationRange[] = [];
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
  isolations: readonly TokenIsolationRange[],
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
      canOpen: Boolean(flags & canOpenFlag),
      canClose: Boolean(flags & canCloseFlag),
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

  const result: number[] = [];
  for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
    const config = configByKind[inlineTokenKind(tokens, tokenIndex)];
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
          appendFragment(result, tokens, tokenIndex, offset, replacement.offset, config.fallbackKind);
        }
        appendFragment(result, tokens, tokenIndex, replacement.offset, replacement.end, replacement.kind);
        offset = replacement.end;
      }
    }
    const end = inlineTokenEnd(tokens, tokenIndex);
    if (offset < end) {
      appendFragment(result, tokens, tokenIndex, offset, end, config.fallbackKind);
    }
  }
  return result;
}

export function createDelimitedTokenResolver<State = undefined>(
  delimiterConfigs: readonly DelimiterConfig[],
  pairConfigs: readonly PairedTokenConfig<State>[] = [],
): DelimitedTokenResolver<State> {
  const delimiterByKind: (CompiledDelimiterConfig | undefined)[] = [];
  delimiterConfigs.forEach((config, index) => {
    delimiterByKind[inlineKind(config.token)] = {
      marker: config.marker,
      fallbackKind: inlineKind(config.fallbackToken),
      single: config.single
        ? { open: inlineKind(config.single.open), close: inlineKind(config.single.close) }
        : void 0,
      double: config.double
        ? { open: inlineKind(config.double.open), close: inlineKind(config.double.close) }
        : void 0,
      allowIntraword: config.allowIntraword,
      matchWholeRun: config.pairing.kind === "whole" ? true : void 0,
      ruleOfThree: config.pairing.kind === "partial" ? config.pairing.ruleOfThree : void 0,
      index,
    };
  });
  const pairIndex = indexPairs(pairConfigs);
  const activeKinds: boolean[] = [];
  for (const config of delimiterConfigs) {
    activeKinds[inlineKind(config.token)] = true;
  }
  for (const config of pairConfigs) {
    activeKinds[inlineKind(config.opener)] = true;
    activeKinds[inlineKind(config.closer)] = true;
  }

  const resolve = (source: string, tokens: InlineTokenStream, state: State): InlineTokenStream => {
    const count = inlineTokenCount(tokens);
    let active = false;
    for (let tokenIndex = 0; tokenIndex < count; tokenIndex++) {
      if (activeKinds[inlineTokenKind(tokens, tokenIndex)]) {
        active = true;
        break;
      }
    }
    if (!active) {
      return tokens;
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
      paired = resolvePairedTokens(source, expanded, pairIndex, state);
    }
    const resolvedPairs = applyPairReplacements(expanded ?? tokens, paired.replacements);
    return resolveDelimiterRuns(source, resolvedPairs, delimiterByKind, paired.delimiterIsolations);
  };
  return { resolve };
}
