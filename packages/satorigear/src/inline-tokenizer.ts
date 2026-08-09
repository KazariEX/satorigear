import {
  createDelimitedTokenResolver,
  type DelimiterRunConfig,
  type PairedTokenConfig,
} from "./inline-resolver.ts";
import {
  appendInlineToken,
  copyInlineToken,
  createInlineTokenChange,
  inlineKind,
  type InlineTokenChange,
  inlineTokenCount,
  inlineTokenEnd,
  inlineTokenFlags,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
  inlineTokenStride,
  inlineTokenText,
  tokenizeInline,
} from "./inline-syntax-runtime.ts";
import { normalizeMarkdownReferenceLabel } from "./inline-utils.ts";
import type { TextEdit } from "./text-edit.ts";

type ApplyTokenChange = (edits: readonly TextEdit[], change: InlineTokenChange) => void;

interface MarkdownReferenceState {
  candidates?: Set<string>;
  labels: ReadonlySet<string>;
}

const markdownDelimiterRuns: DelimiterRunConfig[] = [
  {
    token: "AsteriskRun",
    marker: "*",
    fallbackToken: "Delimiter",
    single: { open: "EmphasisOpen", close: "EmphasisClose" },
    double: { open: "StrongOpen", close: "StrongClose" },
    ruleOfThree: true,
  },
  {
    token: "UnderscoreRun",
    marker: "_",
    fallbackToken: "Delimiter",
    single: { open: "EmphasisOpen", close: "EmphasisClose" },
    double: { open: "StrongOpen", close: "StrongClose" },
    intraword: false,
    ruleOfThree: true,
  },
];

function splitReferenceTail(source: string, tokens: InlineTokenStream, index: number): InlineTokenStream {
  const start = inlineTokenStart(tokens, index);
  const end = inlineTokenEnd(tokens, index);
  const flags = inlineTokenFlags(tokens, index);
  const result: number[] = [];
  appendInlineToken(result, inlineKind("ReferenceSeparatorClose"), start, start + 1, flags);
  appendInlineToken(result, inlineKind("BracketOpen"), start + 1, start + 2);
  if (end > start + 3) {
    appendInlineToken(result, inlineKind("Text"), start + 2, end - 1);
  }
  appendInlineToken(result, inlineKind("ShortcutReferenceTail"), end - 1, end);
  return result;
}

// Recover the one-token overlap between adjacent full-reference candidates before pairing.
function reassociateReferenceTails(
  source: string,
  tokens: InlineTokenStream,
  referenceLabels: ReadonlySet<string>,
): InlineTokenStream {
  const referenceTail = inlineKind("ReferenceTail");
  const bracketOpen = inlineKind("BracketOpen");
  const shortcutTail = inlineKind("ShortcutReferenceTail");
  const imageOpen = inlineKind("ImageOpen");
  const count = inlineTokenCount(tokens);
  let result: number[] | undefined;
  for (let index = 0; index < count; index++) {
    const kind = inlineTokenKind(tokens, index);
    const label = kind === referenceTail ? inlineTokenText(source, tokens, index).slice(2, -1) : "";
    if (kind !== referenceTail || referenceLabels.has(normalizeMarkdownReferenceLabel(label))) {
      if (result) {
        copyInlineToken(result, tokens, index);
      }
      continue;
    }
    const openerIndex = index + 1;
    if (
      openerIndex >= count ||
      inlineTokenKind(tokens, openerIndex) !== bracketOpen ||
      inlineTokenStart(tokens, openerIndex) !== inlineTokenEnd(tokens, index)
    ) {
      if (result) {
        copyInlineToken(result, tokens, index);
      }
      continue;
    }
    let closerIndex = index + 2;
    let nested = false;
    while (closerIndex < count && inlineTokenKind(tokens, closerIndex) !== shortcutTail) {
      const closerKind = inlineTokenKind(tokens, closerIndex);
      nested ||= closerKind === bracketOpen || closerKind === imageOpen;
      closerIndex++;
    }
    if (closerIndex === count || nested) {
      if (result) {
        copyInlineToken(result, tokens, index);
      }
      continue;
    }
    const nextLabel = source.slice(inlineTokenEnd(tokens, openerIndex), inlineTokenStart(tokens, closerIndex));
    if (!referenceLabels.has(normalizeMarkdownReferenceLabel(nextLabel))) {
      if (result) {
        copyInlineToken(result, tokens, index);
      }
      continue;
    }
    if (!result) {
      result = [];
      for (let prefix = 0; prefix < index; prefix++) {
        copyInlineToken(result, tokens, prefix);
      }
    }
    const split = splitReferenceTail(source, tokens, index);
    result.push(...split.slice(0, -inlineTokenStride));
    const offset = inlineTokenEnd(tokens, index) - 1;
    appendInlineToken(
      result,
      referenceTail,
      offset,
      inlineTokenEnd(tokens, closerIndex),
      inlineTokenFlags(tokens, index),
    );
    index = closerIndex;
  }
  return result ?? tokens;
}

const activateReference: NonNullable<PairedTokenConfig<MarkdownReferenceState>["activate"]> = ({
  source,
  tokens,
  closerIndex,
  content,
  state,
}) => {
  const closer = inlineTokenText(source, tokens, closerIndex);
  const explicit = closer.startsWith("][") ? closer.slice(2, -1) : "";
  const label = normalizeMarkdownReferenceLabel(explicit || content);
  state.candidates ??= new Set();
  state.candidates.add(label);
  return state.labels.has(label);
};

const markdownBracketPairs: readonly PairedTokenConfig<MarkdownReferenceState>[] = [
  {
    opener: "BracketOpen",
    closer: "LinkTail",
    open: "LinkOpen",
    close: "LinkClose",
    deactivateEarlier: ["BracketOpen"],
    isolateDelimiters: true,
  },
  {
    opener: "ImageOpen",
    closer: "LinkTail",
    open: "ImageLinkOpen",
    close: "ImageLinkClose",
  },
  {
    opener: "BracketOpen",
    closer: "ReferenceTail",
    open: "ReferenceOpen",
    close: "ReferenceClose",
    deactivateEarlier: ["BracketOpen"],
    isolateDelimiters: true,
    activate: activateReference,
    splitUnmatchedCloser: splitReferenceTail,
  },
  {
    opener: "BracketOpen",
    closer: "ShortcutReferenceTail",
    open: "ReferenceOpen",
    close: "ReferenceClose",
    deactivateEarlier: ["BracketOpen"],
    isolateDelimiters: true,
    activate: activateReference,
    content: {
      requireNonWhitespace: true,
      maxCharacters: 999,
      forbidTokens: ["BracketOpen", "ImageOpen"],
    },
  },
  {
    opener: "ImageOpen",
    closer: "ReferenceTail",
    open: "ImageReferenceOpen",
    close: "ImageReferenceClose",
    isolateDelimiters: true,
    activate: activateReference,
    splitUnmatchedCloser: splitReferenceTail,
  },
  {
    opener: "ImageOpen",
    closer: "ShortcutReferenceTail",
    open: "ImageReferenceOpen",
    close: "ImageReferenceClose",
    isolateDelimiters: true,
    activate: activateReference,
    content: {
      requireNonWhitespace: true,
      maxCharacters: 999,
      forbidTokens: ["BracketOpen", "ImageOpen"],
    },
  },
];

const resolver = createDelimitedTokenResolver(markdownDelimiterRuns, markdownBracketPairs);
// Most regions contain no references, so they share one immutable empty candidate set.
const emptyReferenceCandidates: ReadonlySet<string> = new Set();
const emptyTokens: InlineTokenStream = [];

function textEdit(previous: string, next: string): readonly TextEdit[] {
  if (previous.length === 0) {
    return next.length === 0 ? [] : [{ start: 0, end: 0, text: next }];
  }

  let start = 0;
  const common = Math.min(previous.length, next.length);
  while (start < common && previous[start] === next[start]) {
    start++;
  }

  let suffix = 0;
  while (suffix < common - start && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) {
    suffix++;
  }

  if (start === previous.length && start === next.length) {
    return [];
  }
  return [{
    start,
    end: previous.length - suffix,
    text: next.slice(start, next.length - suffix),
  }];
}

export class InlineTokenState {
  // Track only labels consulted by this region so unrelated definitions do not invalidate it.
  #candidates?: ReadonlySet<string>;
  #labels?: ReadonlySet<string>;
  // Keep unresolved tokens so a reference-map change can re-resolve without re-lexing unchanged text.
  #rawTokens?: InlineTokenStream;
  #source?: string;
  #tokens?: InlineTokenStream;

  get tokens(): InlineTokenStream {
    return this.#tokens ?? emptyTokens;
  }

  protected updateTokens(
    source: string,
    labels: ReadonlySet<string>,
    apply?: ApplyTokenChange,
    sourceEdits: readonly TextEdit[] | null = null,
  ): boolean {
    if (source === this.#source && !this.#referencesChanged(labels)) {
      this.#labels = labels;
      return false;
    }

    const previousSource = this.#source ?? "";
    const previousTokens = this.#tokens ?? emptyTokens;
    const edits = this.#rawTokens || apply ? sourceEdits ?? textEdit(previousSource, source) : [];
    const referenceState: MarkdownReferenceState = { labels };
    const rawTokens = edits.length === 0 && this.#rawTokens
      ? this.#rawTokens
      : tokenizeInline(source);
    const associatedTokens = reassociateReferenceTails(source, rawTokens, labels);
    const tokens = resolver.resolve(source, associatedTokens, referenceState);
    apply?.(
      edits,
      createInlineTokenChange(
        previousSource,
        previousTokens,
        source,
        tokens,
        source.length - previousSource.length,
      ),
    );

    this.#source = source;
    this.#labels = labels;
    this.#candidates = referenceState.candidates ?? emptyReferenceCandidates;
    this.#rawTokens = rawTokens;
    this.#tokens = tokens;
    return true;
  }

  #referencesChanged(labels: ReadonlySet<string>): boolean {
    if (!this.#candidates || !this.#labels) {
      return true;
    }
    for (const candidate of this.#candidates) {
      if (this.#labels.has(candidate) !== labels.has(candidate)) {
        return true;
      }
    }
    return false;
  }
}
