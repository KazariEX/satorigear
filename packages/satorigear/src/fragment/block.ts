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
  tokenEnd: number,
) => T;

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
  tokenEnd: number,
): T {
  const kind = context.structure.tokens.kind(tokenStart);
  return context.structure.builds[kind]!(tokenStart, context, tokenEnd) as T;
}

export function buildBlockChildren<T extends object = RootContent>(
  firstChild: number,
  tokenEnd: number,
  context: BlockBuildContext,
): T[] {
  const builds = context.structure.builds;
  const tokens = context.structure.tokens;
  // Avoid the capacity allocation overhead of push() on a single child node.
  let children: T[] | undefined;
  for (let child = firstChild; child < tokenEnd;) {
    const length = tokens.nodeLength(child);
    if (length > 0) {
      const build = builds[tokens.kind(child)];
      if (build) {
        const node = build(child, context, child + length) as T;
        if (children) {
          children.push(node);
        }
        else {
          children = [node];
        }
      }
    }
    child += length || 1;
  }
  return children ?? [];
}
