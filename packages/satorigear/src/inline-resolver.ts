import type { Token } from "monogram/gen-lexer.ts";

export interface DelimiterRunConfig {
  token: string;
  marker: string;
  fallbackToken: string;
  single: { open: string; close: string };
  double: { open: string; close: string };
  intraword?: boolean;
  ruleOfThree?: boolean;
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
  splitUnmatchedCloser?: (token: Token) => Token[];
}

interface PairedTokenActivationContext<State = undefined> {
  source: string;
  tokens: readonly Token[];
  opener: Token;
  closer: Token;
  content: string;
  state: State;
}

interface TokenIsolationRange {
  start: number;
  end: number;
  id: number;
}

interface DelimitedTokenResolver<State> {
  resolve: (source: string, tokens: readonly Token[], state: State) => readonly Token[];
}

interface Run {
  tokenIndex: number;
  token: Token;
  config: DelimiterRunConfig;
  configIndex: number;
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
  type: string;
}

interface PairIndex<State> {
  byCloser: ReadonlyMap<string, readonly IndexedPair<State>[]>;
  openerTypes: readonly boolean[];
  splitByCloser: ReadonlyMap<string, (token: Token) => Token[]>;
  typeIndices: ReadonlyMap<string, number>;
}

interface IndexedPair<State> {
  config: PairedTokenConfig<State>;
  deactivatedTypes: readonly number[];
  forbiddenTypes: readonly number[];
  openerType: number;
}

interface PairResolution {
  replacements: readonly string[];
  matchedClosers: readonly boolean[];
  delimiterIsolations: TokenIsolationRange[];
}

interface IndexedDelimiterConfig {
  config: DelimiterRunConfig;
  index: number;
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
function flanking(source: string, token: Token, config: DelimiterRunConfig): number {
  const before = characterBefore(source, token.offset);
  const after = characterAfter(source, token.offset + token.text.length);
  const beforeWhitespace = whitespace.test(before);
  const afterWhitespace = whitespace.test(after);
  const beforePunctuation = punctuation.test(before);
  const afterPunctuation = punctuation.test(after);
  const left = !afterWhitespace && (!afterPunctuation || beforeWhitespace || beforePunctuation);
  const right = !beforeWhitespace && (!beforePunctuation || afterWhitespace || afterPunctuation);
  if (config.intraword !== false) {
    return (left ? canOpenFlag : 0) | (right ? canCloseFlag : 0);
  }
  const canOpen = left && (!right || beforePunctuation);
  const canClose = right && (!left || afterPunctuation);
  return (canOpen ? canOpenFlag : 0) | (canClose ? canCloseFlag : 0);
}

function canPair(opener: Run, closer: Run): boolean {
  if (!opener.canOpen || !closer.canClose) {
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
    if (config.maxCharacters != null) {
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
  const byCloser = new Map<string, IndexedPair<State>[]>();
  const typeIndices = new Map<string, number>();
  const openerTypes: boolean[] = [];
  const splitByCloser = new Map<string, (token: Token) => Token[]>();
  const typeIndex = (type: string): number => {
    const previous = typeIndices.get(type);
    if (previous !== void 0) {
      return previous;
    }
    const index = typeIndices.size;
    typeIndices.set(type, index);
    return index;
  };
  for (const config of configs) {
    const openerType = typeIndex(config.opener);
    openerTypes[openerType] = true;
    const pairs = byCloser.get(config.closer) ?? [];
    pairs.push({
      config,
      deactivatedTypes: config.deactivateEarlier?.map(typeIndex) ?? [],
      forbiddenTypes: config.content?.forbidTokens?.map(typeIndex) ?? [],
      openerType,
    });
    byCloser.set(config.closer, pairs);
    if (config.splitUnmatchedCloser) {
      splitByCloser.set(config.closer, config.splitUnmatchedCloser);
    }
  }
  return { byCloser, openerTypes, splitByCloser, typeIndices };
}

function resolvePairedTokens<State>(
  source: string,
  tokens: readonly Token[],
  index: PairIndex<State>,
  state: State,
): PairResolution {
  const openerStacks: number[][] = [];
  const inactiveBefore: number[] = [];
  const lastSeen: number[] = [];
  const replacements: string[] = [];
  const matchedClosers: boolean[] = [];
  const delimiterIsolations: TokenIsolationRange[] = [];

  function resolveCloser(token: Token, tokenIndex: number): void {
    const pairs = index.byCloser.get(token.type);
    if (!pairs) {
      return;
    }

    let openerIndex = -1;
    let pair = pairs[0];
    let openerStack: number[] | null = null;
    for (const candidate of pairs) {
      const candidates = openerStacks[candidate.openerType];
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
    if (openerStack === null) {
      return;
    }

    openerStack.pop();
    if (openerIndex + 1 < (inactiveBefore[pair.openerType] ?? 0)) {
      return;
    }

    const { config } = pair;
    const openerToken = tokens[openerIndex];
    const contentStart = openerToken.offset + openerToken.text.length;
    const contentConfig = config.content;
    if (contentConfig && !acceptsContent(source, contentStart, token.offset, contentConfig)) {
      return;
    }
    if (pair.forbiddenTypes.length > 0) {
      for (const forbiddenType of pair.forbiddenTypes) {
        if ((lastSeen[forbiddenType] ?? 0) > openerIndex + 1) {
          return;
        }
      }
    }
    if (config.activate) {
      const content = source.slice(contentStart, token.offset);
      if (!config.activate({ source, tokens, opener: openerToken, closer: token, content, state })) {
        return;
      }
    }
    replacements[openerIndex] = config.open;
    replacements[tokenIndex] = config.close;
    matchedClosers[tokenIndex] = true;

    if (pair.deactivatedTypes.length > 0) {
      for (const type of pair.deactivatedTypes) {
        inactiveBefore[type] = Math.max(inactiveBefore[type] ?? 0, openerIndex + 1);
      }
    }

    if (config.isolateDelimiters) {
      delimiterIsolations.push({
        start: contentStart,
        end: token.offset,
        id: delimiterIsolations.length,
      });
    }
  }

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex];
    const typeIndex = index.typeIndices.get(token.type);
    if (typeIndex !== void 0 && index.openerTypes[typeIndex]) {
      const stack = openerStacks[typeIndex] ?? [];
      stack.push(tokenIndex);
      openerStacks[typeIndex] = stack;
    }
    resolveCloser(token, tokenIndex);
    if (typeIndex !== void 0) {
      lastSeen[typeIndex] = tokenIndex + 1;
    }
  }

  return {
    replacements,
    matchedClosers,
    delimiterIsolations,
  };
}

function applyPairReplacements(
  tokens: readonly Token[],
  replacements: readonly string[],
): readonly Token[] {
  if (replacements.length === 0) {
    return tokens;
  }
  const result = tokens.slice();
  for (let tokenIndex = 0; tokenIndex < replacements.length; tokenIndex++) {
    const type = replacements[tokenIndex];
    if (type) {
      result[tokenIndex] = { ...result[tokenIndex], type, k: 0, t: 0 };
    }
  }
  return result;
}

function tokenFragment(
  base: Token,
  offset: number,
  end: number,
  type: string,
): Token {
  const first = offset === base.offset;
  return {
    ...base,
    type,
    text: base.text.slice(offset - base.offset, end - base.offset),
    offset,
    k: 0,
    t: 0,
    newlineBefore: first && base.newlineBefore,
    commentBefore: first && base.commentBefore,
    multilineFlowBefore: first && base.multilineFlowBefore,
  };
}

function assignDelimiterScopes(runs: Run[], isolations: readonly TokenIsolationRange[]): void {
  if (isolations.length === 0) {
    return;
  }

  const ordered = [...isolations].sort((left, right) => left.start - right.start || right.end - left.end);
  const active: TokenIsolationRange[] = [];
  let isolationIndex = 0;

  for (const run of runs) {
    while (isolationIndex < ordered.length && ordered[isolationIndex].start <= run.token.offset) {
      const isolation = ordered[isolationIndex++];
      while (active.length > 0 && active[active.length - 1].end <= isolation.start) {
        active.pop();
      }
      const parent = active[active.length - 1];
      if (parent && isolation.end > parent.end) {
        throw new Error("Delimiter isolation ranges must be nested or disjoint");
      }
      if (isolation.end > run.token.offset) {
        active.push(isolation);
      }
    }
    while (active.length > 0 && active[active.length - 1].end <= run.token.offset) {
      active.pop();
    }
    run.scope = active[active.length - 1]?.id ?? -1;
  }
}

function unlinkRun(runs: Run[], runIndex: number): void {
  const run = runs[runIndex];
  if (run.previous >= 0) {
    runs[run.previous].next = run.next;
  }
  if (run.next >= 0) {
    runs[run.next].previous = run.previous;
  }
}

function addReplacement(
  replacements: Replacement[][],
  tokenIndex: number,
  replacement: Replacement,
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
  runs: Run[],
  first: number,
  replacements: Replacement[][],
): void {
  // Failed searches establish a lower bound for equivalent closers, preventing
  // pathological unmatched runs from repeatedly scanning the same opener prefix.
  // The bound remains a run identity because that run may later be unlinked.
  const openersBottom: number[] = [];
  let current = first;

  while (current >= 0) {
    const closer = runs[current];
    const next = closer.next;
    if (!closer.canClose || closer.remaining === 0) {
      current = next;
      continue;
    }

    const bottomSlot = closer.configIndex * 6 + (closer.canOpen ? 3 : 0) + closer.length % 3;
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
    const use = opener.remaining >= 2 && closer.remaining >= 2 ? 2 : 1;
    const openEnd = opener.token.offset + (opener.start + opener.remaining) * opener.config.marker.length;
    const openStart = openEnd - use * opener.config.marker.length;
    const closeStart = closer.token.offset + closer.start * closer.config.marker.length;
    const closeEnd = closeStart + use * closer.config.marker.length;
    const pair = use === 2 ? closer.config.double : closer.config.single;
    addReplacement(replacements, opener.tokenIndex, { offset: openStart, end: openEnd, type: pair.open });
    addReplacement(replacements, closer.tokenIndex, { offset: closeStart, end: closeEnd, type: pair.close });
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

function resolveDelimiterRunsWithIndex(
  source: string,
  tokens: readonly Token[],
  configByToken: ReadonlyMap<string, IndexedDelimiterConfig>,
  isolations: readonly TokenIsolationRange[] = [],
): readonly Token[] {
  const runs: Run[] = [];
  tokens.forEach((token, tokenIndex) => {
    const indexed = configByToken.get(token.type);
    if (!indexed) {
      return;
    }
    const { config } = indexed;
    const length = token.text.length / config.marker.length;
    const flags = flanking(source, token, config);
    runs.push({
      tokenIndex,
      token,
      config,
      configIndex: indexed.index,
      length,
      start: 0,
      remaining: length,
      scope: -1,
      previous: -1,
      next: -1,
      canOpen: Boolean(flags & canOpenFlag),
      canClose: Boolean(flags & canCloseFlag),
    });
  });
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

  const result: Token[] = [];
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex];
    const indexed = configByToken.get(token.type);
    if (!indexed) {
      result.push(token);
      continue;
    }
    const { config } = indexed;
    const matched = replacements[tokenIndex];
    if (matched && matched.length > 1) {
      matched.sort((a, b) => a.offset - b.offset);
    }
    let offset = token.offset;
    if (matched) {
      for (const replacement of matched) {
        if (replacement.offset > offset) {
          result.push(tokenFragment(
            token,
            offset,
            replacement.offset,
            config.fallbackToken,
          ));
          offset = replacement.offset;
        }
        result.push(tokenFragment(token, replacement.offset, replacement.end, replacement.type));
        offset = replacement.end;
      }
    }
    const end = token.offset + token.text.length;
    if (offset < end) {
      result.push(tokenFragment(token, offset, end, config.fallbackToken));
    }
  }
  return result;
}

export function createDelimitedTokenResolver<State = undefined>(
  delimiterConfigs: readonly DelimiterRunConfig[],
  pairConfigs: readonly PairedTokenConfig<State>[] = [],
): DelimitedTokenResolver<State> {
  const delimiterByToken = new Map(delimiterConfigs.map((config, index) => [config.token, { config, index }]));
  const pairIndex = indexPairs(pairConfigs);
  // Plain regions dominate; resolving them would only allocate empty scratch arrays.
  const activeTokens = new Set([
    ...delimiterConfigs.map((config) => config.token),
    ...pairConfigs.flatMap((config) => [config.opener, config.closer]),
  ]);
  const resolve = (source: string, tokens: readonly Token[], state: State): readonly Token[] => {
    let active = false;
    for (const token of tokens) {
      if (activeTokens.has(token.type)) {
        active = true;
        break;
      }
    }
    if (!active) {
      return tokens;
    }

    let paired = resolvePairedTokens(source, tokens, pairIndex, state);
    let expanded: Token[] | null = null;
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
      const token = tokens[tokenIndex];
      const split = pairIndex.splitByCloser.get(token.type);
      const fragments = split && !paired.matchedClosers[tokenIndex] ? split(token) : null;
      if (fragments) {
        expanded ??= tokens.slice(0, tokenIndex);
        expanded.push(...fragments);
      }
      else {
        expanded?.push(token);
      }
    }
    if (expanded) {
      paired = resolvePairedTokens(source, expanded, pairIndex, state);
    }
    const resolvedPairs = applyPairReplacements(expanded ?? tokens, paired.replacements);
    return resolveDelimiterRunsWithIndex(source, resolvedPairs, delimiterByToken, paired.delimiterIsolations);
  };
  return { resolve };
}
