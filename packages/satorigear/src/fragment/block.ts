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
  tokenStart: number,
  context: BlockBuildContext,
) => SpannedNode<T>;

export function blockEnd(tokenStart: number, context: BlockBuildContext): number {
  const offset = context.arena.tokens.start(tokenStart);
  let end = offset + context.arena.lenOf(tokenStart);
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
  tokenStart: number,
  kind: BlockKind,
  context: BlockBuildContext,
): number | undefined {
  const arena = context.arena;
  for (
    let entry = arena.firstChild(tokenStart);
    entry !== noBlockEntry;
    entry = arena.nextChild(tokenStart, entry)
  ) {
    if (entry < 0) {
      const token = arena.leafToken(entry);
      if (arena.tokens.kind(token) === kind) {
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
    throw new Error(`Expected ${context.arena.ruleNameOf(tokenStart)} syntax to contain block token ${kind}`);
  }
  return token;
}

export function payloadBounds(
  tokenStart: number,
  context: BlockBuildContext,
): SourceSpan {
  const arena = context.arena;
  const offset = arena.tokens.start(tokenStart);
  const result = { start: offset + arena.lenOf(tokenStart), end: offset };
  const endToken = tokenStart + arena.tokens.nodeLength(tokenStart);
  for (let token = tokenStart; token < endToken; token++) {
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
  tokenStart: number,
  context: BlockBuildContext,
): SpannedNode<T> => {
  const arena = context.arena;
  const rule = arena.ruleOf(tokenStart);
  const build = rule.build;
  if (!build) {
    throw new Error(`Unexpected block syntax rule: ${rule.name}`);
  }
  return build(tokenStart, context) as SpannedNode<T>;
};

export const buildBlockChildren: (
  tokenStart: number,
  context: BlockBuildContext,
) => SpannedNode<BlockContent | DefinitionContent>[] = (tokenStart, context) => {
  const arena = context.arena;
  const children: SpannedNode<BlockContent | DefinitionContent>[] = [];
  for (
    let childId = arena.firstChild(tokenStart);
    childId !== noBlockEntry;
    childId = arena.nextChild(tokenStart, childId)
  ) {
    if (childId >= 0 && arena.isBlock(childId)) {
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
