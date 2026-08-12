import type { BlockContent, DefinitionContent, TopLevelContent } from "mdast";
import { type BlockToken, tokenEnd, tokenStart } from "../block/tokens.ts";
import type { BlockSyntaxView } from "../block/arena.ts";
import type { SyntaxProfile } from "../profile/types.ts";
import type { SourceSpan } from "../source-view.ts";
import type { PreparedInlineBatch } from "../syntax-state.ts";
import type { SpannedNode } from "./node.ts";

export interface BlockBuildContext {
  profile: SyntaxProfile;
  source: string;
  inline: PreparedInlineBatch;
  view: BlockSyntaxView;
}

// Core owns fragment state and traversal; profiles supply every syntax-specific node builder.
export type BlockNodeBuilder = (
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockBuildContext,
) => SpannedNode<TopLevelContent>;

export function blockEnd(nodeId: number, offset: number, context: BlockBuildContext): number {
  let end = offset + context.view.arena.lenOf(nodeId);
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
  tokenType: string,
  context: BlockBuildContext,
): BlockToken | undefined {
  const arena = context.view.arena;
  const childCount = arena.childCount(nodeId);
  for (let index = 0; index < childCount; index++) {
    const entry = arena.childAt(nodeId, index);
    if (entry < 0) {
      const token = context.view.tokenAt(arena.leafToken(entry, tokenBase));
      if (token.type === tokenType) {
        return token;
      }
    }
  }
}

export function blockToken(
  nodeId: number,
  tokenBase: number,
  tokenType: string,
  context: BlockBuildContext,
): BlockToken {
  const token = directBlockToken(nodeId, tokenBase, tokenType, context);
  if (!token) {
    throw new Error(`Expected ${context.view.arena.ruleNameOf(nodeId)} syntax to contain ${tokenType}`);
  }
  return token;
}

export function payloadBounds(
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockBuildContext,
): SourceSpan {
  const arena = context.view.arena;
  const result = { start: offset + arena.lenOf(nodeId), end: offset };
  const visit = (currentId: number, currentTokenBase: number): void => {
    const childCount = arena.childCount(currentId);
    for (let index = 0; index < childCount; index++) {
      const child = arena.childAt(currentId, index);
      if (child < 0) {
        const token = context.view.tokenAt(arena.leafToken(child, currentTokenBase));
        const start = tokenStart(token);
        const end = tokenEnd(token);
        if (end > start) {
          result.start = Math.min(result.start, start);
          result.end = Math.max(result.end, end);
        }
      }
      else {
        visit(child, currentTokenBase + arena.childTokRelAt(currentId, index));
      }
    }
  };
  visit(nodeId, tokenBase);
  return result;
}

export function normalizeLines(value: string): string {
  return value.replace(/\r\n|\r/g, "\n");
}

export function blockChildren(
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockBuildContext,
): (BlockContent | DefinitionContent)[] {
  const arena = context.view.arena;
  const children: (BlockContent | DefinitionContent)[] = [];
  const childCount = arena.childCount(nodeId);
  for (let index = 0; index < childCount; index++) {
    const childId = arena.childAt(nodeId, index);
    if (childId >= 0 && context.view.arena.isBlock(childId)) {
      children.push(buildBlockNode(
        childId,
        offset + arena.childRelAt(nodeId, index),
        tokenBase + arena.childTokRelAt(nodeId, index),
        context,
      ) as BlockContent | DefinitionContent);
    }
  }
  return children;
}

export function buildBlockNode(
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockBuildContext,
): SpannedNode<TopLevelContent> {
  const arena = context.view.arena;
  const rule = arena.ruleOf(nodeId);
  const build = rule.build;
  if (!build) {
    throw new Error(`Unexpected block syntax rule: ${rule.name}`);
  }
  return build(nodeId, offset, tokenBase, context);
}
