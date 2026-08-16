import type { BlockContent, DefinitionContent, RootContent, TopLevelContent } from "mdast";
import { lineContentEnd } from "../block/lines.ts";
import { type BlockStructure, noBlockEntry } from "../block/structure.ts";
import { buildInlineFragment, type InlineFragment } from "./inline.ts";
import type { BlockKind } from "../block/kinds.ts";
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

// Core owns fragment state and traversal; profiles supply every syntax-specific node builder.
export type BlockNodeBuilder<T extends object = RootContent> = (
  tokenStart: number,
  context: BlockBuildContext,
  inline?: InlineFragment,
) => SpannedNode<T>;

export function blockEnd(tokenStart: number, context: BlockBuildContext): number {
  const offset = context.structure.tokens.start(tokenStart);
  return lineContentEnd(context.source, offset, offset + context.structure.lenOf(tokenStart));
}

export function directBlockToken(
  tokenStart: number,
  kind: BlockKind,
  context: BlockBuildContext,
): number | undefined {
  const structure = context.structure;
  for (
    let entry = structure.firstChild(tokenStart);
    entry !== noBlockEntry;
    entry = structure.nextChild(tokenStart, entry)
  ) {
    if (entry < 0) {
      const token = structure.leafToken(entry);
      if (structure.tokens.kind(token) === kind) {
        return token;
      }
    }
  }
}

export function blockToken(
  tokenStart: number,
  kind: BlockKind,
  context: BlockBuildContext,
): number {
  const token = directBlockToken(tokenStart, kind, context);
  if (token === void 0) {
    throw new Error(`Expected ${context.structure.ruleNameOf(tokenStart)} syntax to contain block token ${kind}`);
  }
  return token;
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
    throw new Error(`Unexpected block syntax rule: ${rule.name}`);
  }
  return (
    rule.inlineContent
      ? build(
        tokenStart,
        context,
        buildInlineFragment(tokenStart, context),
      )
      : build(tokenStart, context)
  ) as SpannedNode<T>;
};

export const buildBlockChildren: (
  tokenStart: number,
  context: BlockBuildContext,
) => SpannedNode<BlockContent | DefinitionContent>[] = (tokenStart, context) => {
  const structure = context.structure;
  const children: SpannedNode<BlockContent | DefinitionContent>[] = [];
  for (
    let childId = structure.firstChild(tokenStart);
    childId !== noBlockEntry;
    childId = structure.nextChild(tokenStart, childId)
  ) {
    if (childId >= 0 && structure.isBlock(childId)) {
      children.push(
        buildBlockNode<typeof children[number]>(
          childId,
          context,
        ),
      );
    }
  }
  return children;
};
