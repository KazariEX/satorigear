import type { BlockContent, DefinitionContent, RootContent, TopLevelContent } from "mdast";
import { buildInlineFragment, type InlineFragment } from "./inline.ts";
import type { BlockStructure } from "../block/structure.ts";
import type { InlineProfile } from "../inline/profile.ts";
import type { InlineRegionCursor } from "../inline/region.ts";
import type { SourceSpan } from "../source-view.ts";
import type { SpannedNode } from "./node.ts";

export interface BlockBuildContext {
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

export function payloadBounds(
  tokenStart: number,
  context: BlockBuildContext,
): SourceSpan {
  const structure = context.structure;
  const offset = structure.tokens.start(tokenStart);
  const result = { start: offset + structure.lenOf(tokenStart), end: offset };
  const endToken = tokenStart + structure.tokens.nodeLength(tokenStart);
  for (let token = tokenStart; token < endToken; token++) {
    const start = structure.tokens.start(token);
    const end = structure.tokens.end(token);
    if (end > start) {
      result.start = Math.min(result.start, start);
      result.end = Math.max(result.end, end);
    }
  }
  return result;
}

export const buildBlockNode = <T extends object = TopLevelContent>(
  tokenStart: number,
  context: BlockBuildContext,
): SpannedNode<T> => {
  const structure = context.structure;
  const rule = structure.ruleOf(tokenStart);
  const build = rule.build;
  if (!build) {
    throw new Error(`Unexpected block syntax at token ${tokenStart}`);
  }
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
    if (length > 0 && structure.isBlock(child)) {
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
