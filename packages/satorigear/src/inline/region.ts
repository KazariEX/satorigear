import { emptyArray, emptySet } from "../primitives.ts";
import type { SourceView } from "../source-view.ts";
import type { InlineProfile, InlineResolutionContext } from "./profile.ts";
import type { InlineTokenStream } from "./tokens.ts";

interface TrackedResolutionContext extends InlineResolutionContext {
  definitionContext: InlineResolutionContext;
  dependencies?: Set<string>;
}

function hasDefinition(this: TrackedResolutionContext, key: string): boolean {
  (this.dependencies ??= new Set()).add(key);
  return this.definitionContext.hasDefinition(key);
}

export interface InlineRegionBinding {
  tokenStart: number;
  view: SourceView;
}

export interface ResolvedInlineRegion {
  readonly tokenStart: number;
  readonly tokens: InlineTokenStream;
  readonly view: SourceView;
}

export class InlineRegion implements ResolvedInlineRegion {
  // Track only definitions consulted by this region so unrelated definitions do not invalidate it.
  #definitionDependencies!: ReadonlySet<string>;
  // Keep unresolved tokens so a definition-map change can re-resolve without re-lexing unchanged text.
  #rawTokens?: InlineTokenStream;
  #profile: InlineProfile;
  #tokens?: InlineTokenStream;
  tokenStart: number;
  view: SourceView;

  constructor(
    profile: InlineProfile,
    binding: InlineRegionBinding,
    definitionContext: InlineResolutionContext,
  ) {
    this.#profile = profile;
    this.tokenStart = binding.tokenStart;
    this.view = binding.view;
    this.#updateTokens(binding.view.text, definitionContext, emptySet);
  }

  get tokens(): InlineTokenStream {
    return this.#tokens ?? emptyArray;
  }

  update(
    binding: InlineRegionBinding,
    definitionContext: InlineResolutionContext,
    definitionMembershipChanges: ReadonlySet<string>,
  ): this {
    this.#updateTokens(binding.view.text, definitionContext, definitionMembershipChanges);
    this.#rebind(binding);
    return this;
  }

  updateDefinitions(
    definitionContext: InlineResolutionContext,
    definitionMembershipChanges: ReadonlySet<string>,
  ): boolean {
    return this.#updateTokens(this.view.text, definitionContext, definitionMembershipChanges);
  }

  shift(delta: number, tokenDelta: number): void {
    this.tokenStart += tokenDelta;
    this.view.shift(delta);
  }

  #dependenciesChanged(definitionMembershipChanges: ReadonlySet<string>): boolean {
    const dependencies = this.#definitionDependencies;
    // Definition-heavy edits stay linear in the smaller side of the intersection.
    if (dependencies.size < definitionMembershipChanges.size) {
      for (const key of dependencies) {
        if (definitionMembershipChanges.has(key)) {
          return true;
        }
      }
    }
    else {
      for (const key of definitionMembershipChanges) {
        if (dependencies.has(key)) {
          return true;
        }
      }
    }
    return false;
  }

  #rebind(binding: InlineRegionBinding): void {
    this.tokenStart = binding.tokenStart;
    this.view = binding.view;
  }

  #updateTokens(
    source: string,
    definitionContext: InlineResolutionContext,
    definitionMembershipChanges: ReadonlySet<string>,
  ): boolean {
    const previousTokens = this.#rawTokens;
    const sourceUnchanged = previousTokens !== void 0 && source === this.view.text;
    if (sourceUnchanged && !this.#dependenciesChanged(definitionMembershipChanges)) {
      return false;
    }

    // Incremental regions retain exactly the definition lookups that can invalidate them.
    const context: TrackedResolutionContext = {
      definitionContext,
      hasDefinition,
    };
    const rawTokens = sourceUnchanged
      ? previousTokens
      : this.#profile.tokenize(source);
    const tokens = this.#profile.resolve(source, rawTokens, context);

    this.#definitionDependencies = context.dependencies ?? emptySet;
    this.#rawTokens = rawTokens;
    this.#tokens = tokens;
    return true;
  }
}

// Block building follows source order, so projection needs only one forward cursor.
export class InlineRegionCursor {
  #index = 0;
  #regions: readonly ResolvedInlineRegion[];

  constructor(regions: readonly ResolvedInlineRegion[] = emptyArray) {
    this.#regions = regions;
  }

  reset(regions: readonly ResolvedInlineRegion[]): void {
    this.#index = 0;
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
