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
  byCloser: ReadonlyMap<string, ReadonlyMap<string, IndexedPair<State>>>;
  forbiddenTypes: ReadonlySet<string>;
  openerTypes: ReadonlySet<string>;
  splitByCloser: ReadonlyMap<string, (token: Token) => Token[]>;
}

interface IndexedPair<State> {
  config: PairedTokenConfig<State>;
  deactivatedTypes: ReadonlySet<string>;
  forbiddenTypes: ReadonlySet<string>;
}

interface PairResolution {
  replacements: ReadonlyMap<number, string>;
  matchedClosers: ReadonlySet<number>;
  delimiterIsolations: TokenIsolationRange[];
}

interface IndexedDelimiterConfig {
  config: DelimiterRunConfig;
  index: number;
}

const whitespace = /\s/u;
const punctuation = /[\p{P}\p{S}]/u;

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

function flanking(source: string, token: Token, config: DelimiterRunConfig): Pick<Run, "canOpen" | "canClose"> {
  const before = characterBefore(source, token.offset);
  const after = characterAfter(source, token.offset + token.text.length);
  const beforeWhitespace = whitespace.test(before);
  const afterWhitespace = whitespace.test(after);
  const beforePunctuation = punctuation.test(before);
  const afterPunctuation = punctuation.test(after);
  const left = !afterWhitespace && (!afterPunctuation || beforeWhitespace || beforePunctuation);
  const right = !beforeWhitespace && (!beforePunctuation || afterWhitespace || afterPunctuation);
  if (config.intraword !== false) {
    return { canOpen: left, canClose: right };
  }
  return {
    canOpen: left && (!right || beforePunctuation),
    canClose: right && (!left || afterPunctuation),
  };
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
  const byCloser = new Map<string, Map<string, IndexedPair<State>>>();
  const forbiddenTypes = new Set<string>();
  const openerTypes = new Set<string>();
  const splitByCloser = new Map<string, (token: Token) => Token[]>();
  for (const config of configs) {
    openerTypes.add(config.opener);
    const byOpener = byCloser.get(config.closer) ?? new Map<string, IndexedPair<State>>();
    const forbidden = new Set(config.content?.forbidTokens);
    for (const type of forbidden) {
      forbiddenTypes.add(type);
    }
    byOpener.set(config.opener, {
      config,
      deactivatedTypes: new Set(config.deactivateEarlier),
      forbiddenTypes: forbidden,
    });
    byCloser.set(config.closer, byOpener);
    if (config.splitUnmatchedCloser) {
      splitByCloser.set(config.closer, config.splitUnmatchedCloser);
    }
  }
  return { byCloser, forbiddenTypes, openerTypes, splitByCloser };
}

function resolvePairedTokens<State>(
  source: string,
  tokens: readonly Token[],
  index: PairIndex<State>,
  state: State,
): PairResolution {
  const openerStacks = new Map<string, number[]>();
  const inactiveBefore = new Map<string, number>();
  const lastSeen = new Map<string, number>();
  const replacements = new Map<number, string>();
  const matchedClosers = new Set<number>();
  const delimiterIsolations: TokenIsolationRange[] = [];

  function resolveCloser(token: Token, tokenIndex: number): void {
    const byOpener = index.byCloser.get(token.type);
    if (!byOpener) {
      return;
    }

    let openerIndex = -1;
    let openerType: string | null = null;
    let openerStack: number[] | null = null;
    for (const candidateType of byOpener.keys()) {
      const candidates = openerStacks.get(candidateType);
      if (!candidates || candidates.length === 0) {
        continue;
      }
      const candidate = candidates[candidates.length - 1];
      if (candidate > openerIndex) {
        openerIndex = candidate;
        openerType = candidateType;
        openerStack = candidates;
      }
    }
    if (openerIndex < 0 || openerType === null || openerStack === null) {
      return;
    }

    openerStack.pop();
    if (openerIndex < (inactiveBefore.get(openerType) ?? -1)) {
      return;
    }

    const indexed = byOpener.get(openerType)!;
    const { config } = indexed;
    const openerToken = tokens[openerIndex];
    const contentStart = openerToken.offset + openerToken.text.length;
    const contentConfig = config.content;
    if (contentConfig && !acceptsContent(source, contentStart, token.offset, contentConfig)) {
      return;
    }
    if (indexed.forbiddenTypes.size > 0) {
      for (const forbiddenType of indexed.forbiddenTypes) {
        if ((lastSeen.get(forbiddenType) ?? -1) > openerIndex) {
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
    replacements.set(openerIndex, config.open);
    replacements.set(tokenIndex, config.close);
    matchedClosers.add(tokenIndex);

    if (indexed.deactivatedTypes.size > 0) {
      for (const type of indexed.deactivatedTypes) {
        inactiveBefore.set(type, Math.max(inactiveBefore.get(type) ?? -1, openerIndex));
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
    if (index.openerTypes.has(token.type)) {
      const stack = openerStacks.get(token.type) ?? [];
      stack.push(tokenIndex);
      openerStacks.set(token.type, stack);
    }
    resolveCloser(token, tokenIndex);
    if (index.forbiddenTypes.has(token.type)) {
      lastSeen.set(token.type, tokenIndex);
    }
  }

  return {
    replacements,
    matchedClosers,
    delimiterIsolations,
  };
}

function applyPairReplacements(tokens: readonly Token[], replacements: ReadonlyMap<number, string>): readonly Token[] {
  if (replacements.size === 0) {
    return tokens;
  }
  const result = tokens.slice();
  for (const [tokenIndex, type] of replacements) {
    result[tokenIndex] = { ...result[tokenIndex], type, k: 0, t: 0 };
  }
  return result;
}

function replacementToken(base: Token, replacement: Replacement, first: boolean): Token {
  return {
    ...base,
    type: replacement.type,
    text: base.text.slice(replacement.offset - base.offset, replacement.end - base.offset),
    offset: replacement.offset,
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
  replacements: Map<number, Replacement[]>,
  tokenIndex: number,
  replacement: Replacement,
): void {
  const tokenReplacements = replacements.get(tokenIndex);
  if (tokenReplacements) {
    tokenReplacements.push(replacement);
  }
  else {
    replacements.set(tokenIndex, [replacement]);
  }
}

function matchDelimiterRuns(
  runs: Run[],
  first: number,
  replacements: Map<number, Replacement[]>,
): void {
  // Failed searches establish a lower bound for equivalent closers, preventing
  // pathological unmatched runs from repeatedly scanning the same opener prefix.
  // The bound remains a run identity because that run may later be unlinked.
  const openersBottom = new Map<number, number>();
  let current = first;

  while (current >= 0) {
    const closer = runs[current];
    const next = closer.next;
    if (!closer.canClose || closer.remaining === 0) {
      current = next;
      continue;
    }

    const bottomSlot = closer.configIndex * 6 + (closer.canOpen ? 3 : 0) + closer.length % 3;
    const bottom = openersBottom.get(bottomSlot) ?? -1;
    let openerIndex = closer.previous;
    while (openerIndex >= 0 && openerIndex !== bottom) {
      const opener = runs[openerIndex];
      if (opener.config === closer.config && opener.remaining > 0 && canPair(opener, closer)) {
        break;
      }
      openerIndex = opener.previous;
    }

    if (openerIndex < 0 || openerIndex === bottom) {
      openersBottom.set(bottomSlot, closer.previous);
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
      ...flanking(source, token, config),
    });
  });
  if (runs.length === 0) {
    return tokens;
  }

  assignDelimiterScopes(runs, isolations);
  const scopes = new Map<number, { first: number; last: number }>();
  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const run = runs[runIndex];
    const scope = scopes.get(run.scope);
    if (scope) {
      run.previous = scope.last;
      runs[scope.last].next = runIndex;
      scope.last = runIndex;
    }
    else {
      scopes.set(run.scope, { first: runIndex, last: runIndex });
    }
  }

  const replacements = new Map<number, Replacement[]>();
  for (const scope of scopes.values()) {
    matchDelimiterRuns(runs, scope.first, replacements);
  }

  const result: Token[] = [];
  tokens.forEach((token, tokenIndex) => {
    const indexed = configByToken.get(token.type);
    if (!indexed) {
      result.push(token);
      return;
    }
    const { config } = indexed;
    const matched = (replacements.get(tokenIndex) ?? []).sort((a, b) => a.offset - b.offset);
    const fragments: Replacement[] = [];
    let offset = token.offset;
    for (const replacement of matched) {
      if (replacement.offset > offset) {
        fragments.push({ offset, end: replacement.offset, type: config.fallbackToken });
      }
      fragments.push(replacement);
      offset = replacement.end;
    }
    const end = token.offset + token.text.length;
    if (offset < end) {
      fragments.push({ offset, end, type: config.fallbackToken });
    }
    for (let index = 0; index < fragments.length; index++) {
      result.push(replacementToken(token, fragments[index], index === 0));
    }
  });
  return result;
}

export function createDelimitedTokenResolver<State = undefined>(
  delimiterConfigs: readonly DelimiterRunConfig[],
  pairConfigs: readonly PairedTokenConfig<State>[] = [],
): DelimitedTokenResolver<State> {
  const delimiterByToken = new Map(delimiterConfigs.map((config, index) => [config.token, { config, index }]));
  const pairIndex = indexPairs(pairConfigs);
  const resolve = (source: string, tokens: readonly Token[], state: State): readonly Token[] => {
    let paired = resolvePairedTokens(source, tokens, pairIndex, state);
    let expanded: Token[] | null = null;
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
      const token = tokens[tokenIndex];
      const split = pairIndex.splitByCloser.get(token.type);
      const fragments = split && !paired.matchedClosers.has(tokenIndex) ? split(token) : null;
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
