import { BlockKind } from "../constants/block.ts";
import { emptyArray, emptySet } from "../primitives.ts";
import { SourceView } from "../source-view.ts";
import type { BlockTokenStream } from "../block/tokens.ts";
import type { InlineProfile, InlineResolutionContext } from "./profile.ts";
import type { InlineTokenStream } from "./tokens.ts";

const definitionAny = Symbol();

interface TrackedResolutionContext extends InlineResolutionContext {
  definitionContext: InlineResolutionContext;
  dependencies?: Set<string | typeof definitionAny>;
}

function hasDefinition(this: TrackedResolutionContext, key: string): boolean {
  (this.dependencies ??= new Set()).add(key);
  return this.definitionContext.hasDefinition(key);
}

function hasDefinitions(this: TrackedResolutionContext): boolean {
  const hasAny = this.definitionContext.hasDefinitions();
  if (!hasAny) {
    // Without keys to consult, any later definition can change a bracket candidate.
    (this.dependencies ??= new Set()).add(definitionAny);
  }
  return hasAny;
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
  // Track consulted definitions, or all future definitions when no concrete key can be consulted.
  #definitionDependencies!: ReadonlySet<string | typeof definitionAny>;
  // Keep unresolved tokens so a definition-map change can re-resolve without re-lexing unchanged text.
  #rawTokens?: InlineTokenStream;
  #profile: InlineProfile;
  #tokens!: InlineTokenStream;
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
    return this.#tokens;
  }

  update(
    binding: InlineRegionBinding,
    definitionContext: InlineResolutionContext,
    definitionMembershipChanges: ReadonlySet<string>,
  ): this {
    this.#updateTokens(binding.view.text, definitionContext, definitionMembershipChanges);
    this.tokenStart = binding.tokenStart;
    this.view = binding.view;
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
    if (dependencies.has(definitionAny)) {
      return definitionMembershipChanges.size > 0;
    }
    // The sentinel case returned above, so all remaining dependencies are labels.
    const labels = dependencies as ReadonlySet<string>;
    // Definition-heavy edits stay linear in the smaller side of the intersection.
    if (labels.size < definitionMembershipChanges.size) {
      for (const key of labels) {
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
      hasDefinitions,
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

export function resolveInlineRegion(
  source: string,
  profile: InlineProfile,
  tokens: BlockTokenStream,
  tokenStart: number,
): ResolvedInlineRegion | undefined {
  const view = inlineViewOf(
    source,
    tokens,
    tokenStart,
    tokens.nodeLength(tokenStart),
  );
  if (!view) {
    return;
  }
  const text = view.text;
  return {
    tokenStart,
    tokens: profile.resolve(text, profile.tokenize(text), tokens),
    view,
  };
}

export function inlineViewOf(
  source: string,
  tokens: BlockTokenStream,
  tokenStart: number,
  nodeLength: number,
): SourceView | undefined {
  let firstStart = -1;
  let firstEnd = -1;
  let ranges: number[] | undefined;
  const tokenEnd = tokenStart + nodeLength;
  for (let token = tokenStart + 1; token < tokenEnd; token++) {
    if (tokens.kind(token) !== BlockKind.InlineChunk) {
      continue;
    }
    const start = tokens.start(token);
    const end = tokens.end(token);
    if (firstStart < 0) {
      firstStart = start;
      firstEnd = end;
    }
    // Physically adjacent chunks still form one source slice; only stripped container gaps need segments.
    else if (start === firstEnd) {
      firstEnd = end;
      if (ranges) {
        ranges[ranges.length - 1] = end;
      }
    }
    else {
      ranges ??= [firstStart, firstEnd];
      ranges.push(start, end);
      firstEnd = end;
    }
  }
  if (ranges) {
    return new SourceView(source, ranges);
  }
  if (firstStart >= 0) {
    return new SourceView(source, firstStart, firstEnd);
  }
}
