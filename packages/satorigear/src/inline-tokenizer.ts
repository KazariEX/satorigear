import type { Token } from "monogram/gen-lexer.ts";
import * as inlineRuntime from "./generated/inline.ts";
import {
  markdownBracketPairs,
  markdownDelimiterRuns,
  reassociateMarkdownReferenceTails,
} from "./grammar-inline.ts";
import { createDelimitedTokenResolver } from "./inline-resolution.ts";
import { changedTokenRange, type TokenChange } from "./token-change.ts";
import type { SourceEdit } from "./source-view.ts";

type ApplyTokenChange = (edits: readonly SourceEdit[], change: TokenChange) => void;

const resolver = createDelimitedTokenResolver(markdownDelimiterRuns, markdownBracketPairs);
const emptyTokens: readonly Token[] = [];

function textEdit(previous: string, next: string): readonly SourceEdit[] {
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

export class InlineTokenDocument {
  #candidates?: ReadonlySet<string>;
  #labels?: ReadonlySet<string>;
  #rawTokens?: readonly Token[];
  #source?: string;
  #tokens?: readonly Token[];

  get tokens(): readonly Token[] {
    return this.#tokens ?? emptyTokens;
  }

  update(
    source: string,
    labels: ReadonlySet<string>,
    apply?: ApplyTokenChange,
    sourceEdits: readonly SourceEdit[] | null = null,
  ): boolean {
    if (source === this.#source && !this.#referencesChanged(labels)) {
      this.#labels = labels;
      return false;
    }

    const previousSource = this.#source ?? "";
    const previousTokens = this.#tokens ?? emptyTokens;
    const edits = this.#rawTokens || apply ? sourceEdits ?? textEdit(previousSource, source) : [];
    const candidates = new Set<string>();
    const rawTokens = edits.length === 0 && this.#rawTokens
      ? this.#rawTokens
      : inlineRuntime.tokenize(source);
    const associatedTokens = reassociateMarkdownReferenceTails(source, rawTokens, labels);
    const tokens = resolver.resolve(source, associatedTokens, { labels, candidates });
    if (apply) {
      apply(
        edits,
        changedTokenRange(previousTokens, tokens, source.length - previousSource.length),
      );
    }

    this.#source = source;
    this.#labels = labels;
    this.#candidates = candidates;
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
