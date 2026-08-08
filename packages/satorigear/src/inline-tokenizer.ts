import type { Token } from "monogram/gen-lexer.ts";
import * as generatedInline from "./generated/inline.ts";
import {
  createDelimitedTokenResolver,
  type DelimiterRunConfig,
  type PairedTokenConfig,
} from "./inline-resolver.ts";
import { normalizeMarkdownReferenceLabel } from "./inline-utils.ts";
import { createTokenChange, type TokenChange } from "./token-change.ts";
import type { TextEdit } from "./text-edit.ts";

type ApplyTokenChange = (edits: readonly TextEdit[], change: TokenChange) => void;

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

function tokenFragment(token: Token, type: string, text: string, offset: number, first = false): Token {
  return {
    ...token,
    type,
    text,
    offset,
    k: 0,
    t: 0,
    newlineBefore: first && token.newlineBefore,
    commentBefore: first && token.commentBefore,
    multilineFlowBefore: first && token.multilineFlowBefore,
  };
}

function splitReferenceTail(token: Token): Token[] {
  const label = token.text.slice(2, -1);
  return [
    tokenFragment(token, "ReferenceSeparatorClose", "]", token.offset, true),
    tokenFragment(token, "BracketOpen", "[", token.offset + 1),
    ...(label ? [tokenFragment(token, "Text", label, token.offset + 2)] : []),
    tokenFragment(token, "ShortcutReferenceTail", "]", token.offset + token.text.length - 1),
  ];
}

// Recover the one-token overlap between adjacent full-reference candidates before pairing.
function reassociateReferenceTails(
  source: string,
  tokens: readonly Token[],
  referenceLabels: ReadonlySet<string>,
): readonly Token[] {
  let result: Token[] | undefined;
  for (let index = 0; index < tokens.length; index++) {
    const tail = tokens[index];
    const label = tail.type === "ReferenceTail" ? tail.text.slice(2, -1) : "";
    if (tail.type !== "ReferenceTail" || referenceLabels.has(normalizeMarkdownReferenceLabel(label))) {
      result?.push(tail);
      continue;
    }
    const opener = tokens[index + 1];
    if (opener?.type !== "BracketOpen" || opener.offset !== tail.offset + tail.text.length) {
      result?.push(tail);
      continue;
    }
    let closerIndex = index + 2;
    let nested = false;
    while (closerIndex < tokens.length && tokens[closerIndex].type !== "ShortcutReferenceTail") {
      const type = tokens[closerIndex].type;
      nested ||= type === "BracketOpen" || type === "ImageOpen";
      closerIndex++;
    }
    const closer = tokens[closerIndex];
    if (!closer || nested) {
      result?.push(tail);
      continue;
    }
    const nextLabel = source.slice(opener.offset + opener.text.length, closer.offset);
    if (!referenceLabels.has(normalizeMarkdownReferenceLabel(nextLabel))) {
      result?.push(tail);
      continue;
    }
    result ??= tokens.slice(0, index);
    result.push(...splitReferenceTail(tail).slice(0, -1));
    const offset = tail.offset + tail.text.length - 1;
    result.push(tokenFragment(tail, "ReferenceTail", source.slice(offset, closer.offset + closer.text.length), offset));
    index = closerIndex;
  }
  return result ?? tokens;
}

const activateReference: NonNullable<PairedTokenConfig<MarkdownReferenceState>["activate"]> = ({
  closer,
  content,
  state,
}) => {
  const explicit = closer.text.startsWith("][") ? closer.text.slice(2, -1) : "";
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
const emptyTokens: readonly Token[] = [];

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
  #rawTokens?: readonly Token[];
  #source?: string;
  #tokens?: readonly Token[];

  get tokens(): readonly Token[] {
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
      : generatedInline.tokenize(source);
    const associatedTokens = reassociateReferenceTails(source, rawTokens, labels);
    const tokens = resolver.resolve(source, associatedTokens, referenceState);
    apply?.(
      edits,
      createTokenChange(previousTokens, tokens, source.length - previousSource.length),
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
