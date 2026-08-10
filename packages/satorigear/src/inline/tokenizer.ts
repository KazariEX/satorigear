import {
  createInlineTokenChange,
  type InlineTokenChange,
  type InlineTokenStream,
  tokenizeInline,
} from "./runtime.ts";
import type { InlineResolutionContext, SyntaxProfile } from "../profile/types.ts";
import type { TextEdit } from "../source-view.ts";

type ApplyTokenChange = (edits: readonly TextEdit[], change: InlineTokenChange) => void;

// Most regions consult no definitions, so they share one immutable empty dependency set.
const emptyDefinitionDependencies: ReadonlySet<string> = new Set();
const emptyTokens: InlineTokenStream = [];

interface InlineResolutionContextState extends InlineResolutionContext {
  definitions: ReadonlySet<string>;
  dependencies?: Set<string>;
}

function hasDefinition(this: InlineResolutionContextState, key: string): boolean {
  (this.dependencies ??= new Set()).add(key);
  return this.definitions.has(key);
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
  // Track only definitions consulted by this region so unrelated definitions do not invalidate it.
  #definitionDependencies?: ReadonlySet<string>;
  #definitions?: ReadonlySet<string>;
  #profile: SyntaxProfile;
  // Keep unresolved tokens so a definition-map change can re-resolve without re-lexing unchanged text.
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
    definitions: ReadonlySet<string>,
    apply?: ApplyTokenChange,
    sourceEdits: readonly TextEdit[] | null = null,
  ): boolean {
    if (source === this.#source && !this.#definitionsChanged(definitions)) {
      this.#definitions = definitions;
      return false;
    }

    const previousSource = this.#source ?? "";
    const previousTokens = this.#tokens ?? emptyTokens;
    const edits = this.#rawTokens || apply ? sourceEdits ?? textEdit(previousSource, source) : [];
    const context: InlineResolutionContextState = { definitions, hasDefinition };
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
    this.#definitionDependencies = context.dependencies ?? emptyDefinitionDependencies;
    this.#definitions = definitions;
    this.#rawTokens = rawTokens;
    this.#tokens = tokens;
    return true;
  }

  #definitionsChanged(definitions: ReadonlySet<string>): boolean {
    if (!this.#definitionDependencies || !this.#definitions) {
      return true;
    }
    for (const candidate of this.#definitionDependencies) {
      if (this.#definitions.has(candidate) !== definitions.has(candidate)) {
        return true;
      }
    }
    return false;
  }
}
