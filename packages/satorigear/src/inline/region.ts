import { emptyArray, emptySet } from "../primitives.ts";
import type { SourceView } from "../source-view.ts";
import type { InlineProfile, InlineResolutionContext } from "./profile.ts";
import type { InlineTokenStream } from "./tokens.ts";

interface TrackedResolutionContext extends InlineResolutionContext {
  definitions: ReadonlySet<string>;
  dependencies?: Set<string>;
}

function hasDefinition(this: TrackedResolutionContext, key: string): boolean {
  (this.dependencies ??= new Set()).add(key);
  return this.definitions.has(key);
}

export interface InlineRegionBinding {
  id: number;
  offset: number;
  rule: string;
  view: SourceView;
}

export interface InlineRegionSyntax {
  readonly id: number;
  readonly rule: string;
  readonly tokens: InlineTokenStream;
  readonly view: SourceView;
}

export class InlineRegion implements InlineRegionSyntax {
  // Track only definitions consulted by this region so unrelated definitions do not invalidate it.
  #definitionDependencies!: ReadonlySet<string>;
  #definitions!: ReadonlySet<string>;
  // Keep unresolved tokens so a definition-map change can re-resolve without re-lexing unchanged text.
  #rawTokens?: InlineTokenStream;
  #syntax: InlineProfile;
  #tokenSource?: string;
  #tokens?: InlineTokenStream;
  id: number;
  offset: number;
  revision = 0;
  rule: string;
  view: SourceView;

  constructor(
    syntax: InlineProfile,
    binding: InlineRegionBinding,
    definitions: ReadonlySet<string>,
  ) {
    this.#syntax = syntax;
    this.id = binding.id;
    this.offset = binding.offset;
    this.rule = binding.rule;
    this.view = binding.view;
    this.#updateTokens(binding.view.text, definitions);
  }

  get tokens(): InlineTokenStream {
    return this.#tokens ?? emptyArray;
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

  updateDefinitions(definitions: ReadonlySet<string>): void {
    if (this.#updateTokens(this.view.text, definitions)) {
      this.revision++;
    }
  }

  shift(delta: number): void {
    this.offset += delta;
    this.view.shift(delta);
  }

  #dependenciesChanged(definitions: ReadonlySet<string>): boolean {
    for (const candidate of this.#definitionDependencies) {
      if (this.#definitions.has(candidate) !== definitions.has(candidate)) {
        return true;
      }
    }
    return false;
  }

  #rebind(binding: InlineRegionBinding): void {
    this.id = binding.id;
    this.offset = binding.offset;
    this.rule = binding.rule;
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

    // Incremental regions retain exactly the definition lookups that can invalidate them.
    const context: TrackedResolutionContext = {
      definitions,
      hasDefinition,
    };
    const rawTokens = source === this.#tokenSource && this.#rawTokens
      ? this.#rawTokens
      : this.#syntax.tokenize(source);
    const tokens = this.#syntax.resolve(source, rawTokens, context);

    this.#tokenSource = source;
    this.#definitionDependencies = context.dependencies ?? emptySet;
    this.#definitions = definitions;
    this.#rawTokens = rawTokens;
    this.#tokens = tokens;
    return true;
  }
}

// Block building follows source order, so projection needs only one forward cursor.
export class InlineRegionCursor {
  #index = 0;
  #regions: readonly InlineRegionSyntax[];

  constructor(regions: readonly InlineRegionSyntax[]) {
    this.#regions = regions;
  }

  take(nodeId: number): InlineRegionSyntax | undefined {
    const region = this.#regions[this.#index];
    if (region?.id !== nodeId) {
      return;
    }
    this.#index++;
    return region;
  }
}
