import type { InlineResolutionContext, SyntaxProfile } from "../profile/types.ts";
import type { SourceSpan, SourceView } from "../source-view.ts";
import type { InlineTokenStream } from "./tokens.ts";

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
  #syntax: SyntaxProfile["inline"];
  #tokenSource?: string;
  #tokens?: InlineTokenStream;
  id: number;
  revision = 0;
  rule: string;
  span: SourceSpan;
  view: SourceView;

  constructor(
    syntax: SyntaxProfile["inline"],
    binding: InlineRegionBinding,
    definitions: ReadonlySet<string>,
  ) {
    this.#syntax = syntax;
    this.id = binding.id;
    this.rule = binding.rule;
    this.span = binding.span;
    this.view = binding.view;
    this.#updateTokens(binding.view.text, definitions);
  }

  get tokens(): InlineTokenStream {
    return this.#tokens ?? emptyTokens;
  }

  update(
    binding: InlineRegionBinding,
    definitions: ReadonlySet<string>,
  ): this {
    const changed = this.#updateTokens(binding.view.text, definitions);
    this.#rebind(binding);
    if (!changed) {
      return this;
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
  ): boolean {
    if (source === this.#tokenSource && !this.#dependenciesChanged(definitions)) {
      this.#definitions = definitions;
      return false;
    }

    const context: DefinitionContext = {
      definitions,
      hasDefinition,
      tokenize: this.#syntax.tokenize,
    };
    const rawTokens = source === this.#tokenSource && this.#rawTokens
      ? this.#rawTokens
      : this.#syntax.tokenize(source);
    const tokens = this.#syntax.resolve(source, rawTokens, context);

    this.#tokenSource = source;
    this.#definitionDependencies = context.dependencies ?? noDefinitionDependencies;
    this.#definitions = definitions;
    this.#rawTokens = rawTokens;
    this.#tokens = tokens;
    return true;
  }
}
