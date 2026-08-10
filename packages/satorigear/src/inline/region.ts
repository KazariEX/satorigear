import {
  projectSourceEdits,
  type SourceSpan,
  type SourceView,
  type TextEdit,
} from "../source-view.ts";
import { createInlineSyntaxDocument, type InlineSyntaxDocument } from "./syntax.ts";
import {
  createInlineTokenChange,
  type InlineTokenChange,
  type InlineTokenStream,
  tokenizeInline,
} from "./tokens.ts";
import type { InlineResolutionContext, SyntaxProfile } from "../profile/types.ts";

type ApplyInlineTokenChange = (edits: readonly TextEdit[], change: InlineTokenChange) => void;

// Most regions consult no definitions, so they share one immutable empty dependency set.
const noDefinitionDependencies: ReadonlySet<string> = new Set();
const emptyTokens: InlineTokenStream = [];

interface DefinitionContext extends InlineResolutionContext {
  definitions: ReadonlySet<string>;
  dependencies?: Set<string>;
}

function hasDefinition(this: DefinitionContext, key: string): boolean {
  (this.dependencies ??= new Set()).add(key);
  return this.definitions.has(key);
}

function diffText(previous: string, next: string): readonly TextEdit[] {
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

export interface InlineRegionBinding {
  id: number;
  rule: string;
  span: SourceSpan;
  view: SourceView;
}

export class InlineRegion {
  // Track only definitions consulted by this region so unrelated definitions do not invalidate it.
  #definitionDependencies?: ReadonlySet<string>;
  #definitions?: ReadonlySet<string>;
  // Keep unresolved tokens so a definition-map change can re-resolve without re-lexing unchanged text.
  #rawTokens?: InlineTokenStream;
  #resolveInline: SyntaxProfile["resolveInline"];
  #tokenSource?: string;
  #tokens?: InlineTokenStream;
  id: number;
  revision = 0;
  rule: string;
  span: SourceSpan;
  syntax?: InlineSyntaxDocument;
  view: SourceView;

  constructor(
    resolveInline: SyntaxProfile["resolveInline"],
    binding: InlineRegionBinding,
    definitions: ReadonlySet<string>,
  ) {
    this.#resolveInline = resolveInline;
    this.id = binding.id;
    this.rule = binding.rule;
    this.span = binding.span;
    this.view = binding.view;
    this.#updateTokens(binding.view.text, definitions);
  }

  get source(): string {
    return this.view.text;
  }

  get tokens(): InlineTokenStream {
    return this.#tokens ?? emptyTokens;
  }

  update(
    binding: InlineRegionBinding,
    definitions: ReadonlySet<string>,
    edits: readonly TextEdit[],
  ): this {
    const syntax = this.syntax;
    const sourceEdits = this.view.text !== binding.view.text
      ? projectSourceEdits(this.view, binding.view, edits)
      : void 0;
    const changed = this.#updateTokens(binding.view.text, definitions, syntax?.edit, sourceEdits);
    this.#rebind(binding);
    if (!changed) {
      return this;
    }
    if (!syntax) {
      this.syntax = createInlineSyntaxDocument(binding.view.text, this.tokens);
    }
    this.revision++;
    return this;
  }

  #dependenciesChanged(definitions: ReadonlySet<string>): boolean {
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

  #rebind(binding: InlineRegionBinding): void {
    this.id = binding.id;
    this.rule = binding.rule;
    this.span = binding.span;
    this.view = binding.view;
  }

  #updateTokens(
    source: string,
    definitions: ReadonlySet<string>,
    apply?: ApplyInlineTokenChange,
    sourceEdits?: readonly TextEdit[],
  ): boolean {
    if (source === this.#tokenSource && !this.#dependenciesChanged(definitions)) {
      this.#definitions = definitions;
      return false;
    }

    const previousSource = this.#tokenSource ?? "";
    const previousTokens = this.#tokens ?? emptyTokens;
    const edits = this.#rawTokens || apply ? sourceEdits ?? diffText(previousSource, source) : [];
    const context: DefinitionContext = { definitions, hasDefinition };
    const rawTokens = edits.length === 0 && this.#rawTokens
      ? this.#rawTokens
      : tokenizeInline(source);
    const tokens = this.#resolveInline(source, rawTokens, context);
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

    this.#tokenSource = source;
    this.#definitionDependencies = context.dependencies ?? noDefinitionDependencies;
    this.#definitions = definitions;
    this.#rawTokens = rawTokens;
    this.#tokens = tokens;
    return true;
  }
}
