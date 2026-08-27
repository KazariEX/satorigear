import type { BlockContent, DefinitionContent, RootContent, TopLevelContent } from "mdast";
import { buildInlineFragment, type InlineBuildContext, type InlineFragment } from "./inline.ts";
import type { BlockStructure } from "../block/scanner.ts";
import type { InlineProfile } from "../inline/profile.ts";
import type { InlineRegionCursor } from "../inline/region.ts";
import type { SpannedNode } from "./node.ts";

export interface BlockBuildContext {
  // Inline regions build serially, so this context can be rebound for each region.
  inlineContext: InlineBuildContext | undefined;
  structure: BlockStructure;
  cursor: InlineRegionCursor;
  profile: InlineProfile;
  source: string;
}

// Core owns build traversal; profiles supply every syntax-specific node builder.
export type BlockNodeBuilder<T extends object = RootContent> = (
  tokenStart: number,
  context: BlockBuildContext,
  inline?: InlineFragment,
) => SpannedNode<T>;

export function blockEnd(tokenStart: number, context: BlockBuildContext): number {
  const tokens = context.structure.tokens;
  return tokens.contentEnd(tokenStart + tokens.nodeLength(tokenStart) - 1);
}

export const buildBlockNode = <T extends object = TopLevelContent>(
  tokenStart: number,
  context: BlockBuildContext,
): SpannedNode<T> => {
  const structure = context.structure;
  const rule = structure.ruleOf(tokenStart);
  const build = rule.build!;
  return (
    rule.inlineContent
      ? build(
        tokenStart,
        context,
        buildInlineFragment(tokenStart, rule.rule, context),
      )
      : build(tokenStart, context)
  ) as SpannedNode<T>;
};

export const buildBlockChildren: (
  tokenStart: number,
  context: BlockBuildContext,
) => SpannedNode<BlockContent | DefinitionContent>[] = (tokenStart, context) => {
  const structure = context.structure;
  const tokens = structure.tokens;
  const children: SpannedNode<BlockContent | DefinitionContent>[] = [];
  const tokenEnd = tokenStart + tokens.nodeLength(tokenStart) - 1;
  for (let child = tokenStart + 1; child < tokenEnd;) {
    const length = tokens.nodeLength(child);
    if (length > 0 && structure.ruleOf(child).block) {
      children.push(
        buildBlockNode<typeof children[number]>(
          child,
          context,
        ),
      );
    }
    child += length || 1;
  }
  return children;
};
