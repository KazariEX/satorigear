import {
  createInlineTokenChange,
  type InlineTokenChange,
  type InlineTokenStream,
  tokenizeInline,
} from "./runtime.ts";
import type { InlineResolutionContext, SyntaxProfile } from "../profile/types.ts";
import type { TextEdit } from "../text-edit.ts";

type ApplyTokenChange = (edits: readonly TextEdit[], change: InlineTokenChange) => void;

// Most regions contain no references, so they share one immutable empty dependency set.
const emptyReferenceDependencies: ReadonlySet<string> = new Set();
const emptyTokens: InlineTokenStream = [];

interface InlineResolutionContextState extends InlineResolutionContext {
  dependencies?: Set<string>;
  labels: ReadonlySet<string>;
}

function hasReference(this: InlineResolutionContextState, label: string): boolean {
  (this.dependencies ??= new Set()).add(label);
  return this.labels.has(label);
}

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
  #labels?: ReadonlySet<string>;
  #profile: SyntaxProfile;
  #referenceDependencies?: ReadonlySet<string>;
  // Keep unresolved tokens so a reference-map change can re-resolve without re-lexing unchanged text.
  #rawTokens?: InlineTokenStream;
  #source?: string;
  #tokens?: InlineTokenStream;

  constructor(profile: SyntaxProfile) {
    this.#profile = profile;
  }

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
    const context: InlineResolutionContextState = { hasReference, labels };
    const rawTokens = edits.length === 0 && this.#rawTokens
      ? this.#rawTokens
      : tokenizeInline(source);
    const tokens = this.#profile.resolveInline(source, rawTokens, context);
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
    this.#referenceDependencies = context.dependencies ?? emptyReferenceDependencies;
    this.#rawTokens = rawTokens;
    this.#tokens = tokens;
    return true;
  }

  #referencesChanged(labels: ReadonlySet<string>): boolean {
    if (!this.#referenceDependencies || !this.#labels) {
      return true;
    }
    for (const candidate of this.#referenceDependencies) {
      if (this.#labels.has(candidate) !== labels.has(candidate)) {
        return true;
      }
    }
    return false;
  }
}
