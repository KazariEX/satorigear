import type { BlockContent, DefinitionContent, RootContent, TopLevelContent } from "mdast";
import { type BlockArena, noBlockEntry } from "../block/arena.ts";
import type { BlockKind } from "../block/kinds.ts";
import type { InlineProfile } from "../inline/profile.ts";
import type { InlineRegionCursor } from "../inline/region.ts";
import type { SourceSpan } from "../source-view.ts";
import type { SpannedNode } from "./node.ts";

export interface BlockBuildContext {
  arena: BlockArena;
  inline: InlineRegionCursor;
  profile: InlineProfile;
  source: string;
}

// Core owns fragment state and traversal; profiles supply every syntax-specific node builder.
export type BlockNodeBuilder<T extends object = RootContent> = (
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockBuildContext,
) => SpannedNode<T>;

export function blockEnd(nodeId: number, offset: number, context: BlockBuildContext): number {
  let end = offset + context.arena.lenOf(nodeId);
  if (end > offset && context.source[end - 1] === "\n") {
    end--;
  }
  if (end > offset && context.source[end - 1] === "\r") {
    end--;
  }
  return end;
}

export function firstNonspace(source: string, start: number, end: number): number {
  while (start < end && (source[start] === " " || source[start] === "\t")) {
    start++;
  }
  return start;
}

export function directBlockToken(
  nodeId: number,
  tokenBase: number,
  kind: BlockKind,
  context: BlockBuildContext,
): number | undefined {
  const arena = context.arena;
  for (
    let entry = arena.firstChild(nodeId);
    entry !== noBlockEntry;
    entry = arena.nextChild(nodeId, entry)
  ) {
    if (entry < 0) {
      const token = tokenBase + arena.leafToken(entry) - nodeId;
      if (arena.tokens.kind(token) === kind) {
        return token;
      }
    }
  }
}

export function blockToken(
  nodeId: number,
  tokenBase: number,
  kind: BlockKind,
  context: BlockBuildContext,
): number {
  const token = directBlockToken(nodeId, tokenBase, kind, context);
  if (token === void 0) {
    throw new Error(`Expected ${context.arena.ruleNameOf(nodeId)} syntax to contain block token ${kind}`);
  }
  return token;
}

export function payloadBounds(
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockBuildContext,
): SourceSpan {
  const arena = context.arena;
  const result = { start: offset + arena.lenOf(nodeId), end: offset };
  const endToken = tokenBase + arena.tokens.nodeLength(nodeId);
  for (let token = tokenBase; token < endToken; token++) {
    const start = arena.tokens.start(token);
    const end = arena.tokens.end(token);
    if (end > start) {
      result.start = Math.min(result.start, start);
      result.end = Math.max(result.end, end);
    }
  }
  return result;
}

export function normalizeLines(value: string): string {
  return value.replace(/\r\n|\r/g, "\n");
}

export const buildBlockNode = <T extends object = TopLevelContent>(
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockBuildContext,
): SpannedNode<T> => {
  const arena = context.arena;
  const rule = arena.ruleOf(nodeId);
  const build = rule.build;
  if (!build) {
    throw new Error(`Unexpected block syntax rule: ${rule.name}`);
  }
  return build(nodeId, offset, tokenBase, context) as SpannedNode<T>;
};

export const buildBlockChildren: (
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockBuildContext,
) => SpannedNode<BlockContent | DefinitionContent>[] = (nodeId, offset, tokenBase, context) => {
  const arena = context.arena;
  const children: SpannedNode<BlockContent | DefinitionContent>[] = [];
  for (
    let childId = arena.firstChild(nodeId);
    childId !== noBlockEntry;
    childId = arena.nextChild(nodeId, childId)
  ) {
    if (childId >= 0 && arena.isBlock(childId)) {
      children.push(
        buildBlockNode<typeof children[number]>(
          childId,
          offset + arena.tokens.start(childId) - arena.tokens.start(nodeId),
          tokenBase + childId - nodeId,
          context,
        ),
      );
    }
  }
  return children;
};
