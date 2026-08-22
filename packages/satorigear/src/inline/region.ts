import { emptyArray, emptySet } from "../primitives.ts";
import type { BlockRule } from "../constants/block.ts";
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
  offset: number;
  rule: BlockRule;
  tokenStart: number;
  view: SourceView;
}

export interface ResolvedInlineRegion {
  readonly rule: BlockRule;
  readonly tokenStart: number;
  readonly tokens: InlineTokenStream;
  readonly view: SourceView;
}

export class InlineRegion implements ResolvedInlineRegion {
  // Track only definitions consulted by this region so unrelated definitions do not invalidate it.
  #definitionDependencies!: ReadonlySet<string>;
  #definitions!: ReadonlySet<string>;
  // Keep unresolved tokens so a definition-map change can re-resolve without re-lexing unchanged text.
  #rawTokens?: InlineTokenStream;
  #profile: InlineProfile;
  #tokens?: InlineTokenStream;
  offset: number;
  revision = 0;
  rule: BlockRule;
  tokenStart: number;
  view: SourceView;

  constructor(
    profile: InlineProfile,
    binding: InlineRegionBinding,
    definitions: ReadonlySet<string>,
  ) {
    this.#profile = profile;
    this.offset = binding.offset;
    this.rule = binding.rule;
    this.tokenStart = binding.tokenStart;
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

  shift(delta: number, tokenDelta: number): void {
    this.tokenStart += tokenDelta;
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
    this.offset = binding.offset;
    this.rule = binding.rule;
    this.tokenStart = binding.tokenStart;
    this.view = binding.view;
  }

  #updateTokens(
    source: string,
    definitions: ReadonlySet<string>,
  ): boolean {
    const previousTokens = this.#rawTokens;
    const sourceUnchanged = previousTokens !== void 0 && source === this.view.text;
    if (sourceUnchanged && !this.#dependenciesChanged(definitions)) {
      this.#definitions = definitions;
      return false;
    }

    // Incremental regions retain exactly the definition lookups that can invalidate them.
    const context: TrackedResolutionContext = {
      definitions,
      hasDefinition,
    };
    const rawTokens = sourceUnchanged
      ? previousTokens
      : this.#profile.tokenize(source);
    const tokens = this.#profile.resolve(source, rawTokens, context);

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
  #regions: readonly ResolvedInlineRegion[];

  constructor(regions: readonly ResolvedInlineRegion[]) {
    this.#regions = regions;
  }

  take(tokenStart: number): ResolvedInlineRegion | undefined {
    const region = this.#regions[this.#index];
    if (region?.tokenStart !== tokenStart) {
      return;
    }
    this.#index++;
    return region;
  }
}
