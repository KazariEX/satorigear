import type { Node, RootContent, TopLevelContent } from "mdast";
import type { BlockStructure } from "../block/scanner.ts";
import type { InlineProfile } from "../inline/profile.ts";
import type { InlineRegionCursor } from "../inline/region.ts";
import type { SourceLocator, SourcePosition } from "../source-view.ts";
import type { InlineBuildContext } from "./inline.ts";

export interface BlockBuildContext {
  // Inline regions build serially, so this context can be rebound for each region.
  inlineContext: InlineBuildContext | undefined;
  cursor: InlineRegionCursor | undefined;
  locator: SourceLocator;
  structure: BlockStructure;
  profile: InlineProfile;
  source: string;
}

// Core owns build traversal; profiles supply every syntax-specific node builder.
export type BlockNodeBuilder<T extends object = Node> = (
  tokenStart: number,
  context: BlockBuildContext,
) => T;

export function blockEnd(tokenStart: number, context: BlockBuildContext): number {
  const tokens = context.structure.tokens;
  const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
  // Containers retain a structural closing boundary; leaves own their complete span.
  return tokens.end(close);
}

export function leafBlockPosition(
  tokenStart: number,
  context: BlockBuildContext,
): SourcePosition {
  const tokens = context.structure.tokens;
  return context.locator.positionAt(
    tokens.start(tokenStart),
    tokens.contentEnd(context.source, tokenStart),
  );
}

export function buildBlockNode<T extends object = TopLevelContent>(
  tokenStart: number,
  context: BlockBuildContext,
): T {
  const kind = context.structure.tokens.kind(tokenStart);
  return context.structure.builds[kind]!(tokenStart, context) as T;
}

export function buildBlockChildren<T extends object = RootContent>(
  tokenStart: number,
  context: BlockBuildContext,
): T[] {
  const builds = context.structure.builds;
  const tokens = context.structure.tokens;
  const children: T[] = [];
  const tokenEnd = tokenStart + tokens.nodeLength(tokenStart) - 1;
  for (let child = tokenStart + 1; child < tokenEnd;) {
    const length = tokens.nodeLength(child);
    if (length > 0) {
      const build = builds[tokens.kind(child)];
      if (build) {
        children.push(build(child, context) as T);
      }
    }
    child += length || 1;
  }
  return children;
}
