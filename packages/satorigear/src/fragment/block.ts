import type { Node, RootContent, TopLevelContent } from "mdast";
import { emptyArray } from "../primitives.ts";
import { type SourceLocator, SourceView } from "../source-view.ts";
import type { BlockStructure } from "../block/scanner.ts";
import type { InlineProfile } from "../inline/profile.ts";
import type { InlineRegionCursor } from "../inline/region.ts";
import type { InlineBuildContext } from "./inline.ts";

// Core owns build traversal; profiles supply every syntax-specific node builder.
export type BlockNodeBuilder<T extends object = Node> = (tokenStart: number, context: BlockBuildContext) => T;

export interface BlockBuildContext extends InlineBuildContext {
  cursor: InlineRegionCursor | undefined;
  structure: BlockStructure;
  source: string;
}

export function createBuildContext(
  source: string,
  structure: BlockStructure,
  profile: InlineProfile,
  locator: SourceLocator,
  cursor?: InlineRegionCursor,
): BlockBuildContext {
  return {
    source,
    structure,
    profile,
    locator,
    cursor,
    tokens: emptyArray,
    tokenIndex: 0,
    tableCell: false,
    view: new SourceView(),
  };
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
  const tokenEnd = tokenStart + tokens.nodeLength(tokenStart) - 1;
  // Avoid the capacity allocation overhead of push() on a single child node.
  let children: T[] | undefined;
  for (let child = tokenStart + 1; child < tokenEnd;) {
    const build = builds[tokens.kind(child)];
    if (build) {
      const node = build(child, context) as T;
      if (children) {
        children.push(node);
      }
      else {
        children = [node];
      }
    }
    child += tokens.nodeLength(child);
  }
  return children ?? [];
}
