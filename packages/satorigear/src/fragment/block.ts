import type { BlockContent, DefinitionContent, RootContent, TopLevelContent } from "mdast";
import type { FencedBlock } from "../block/fence.ts";
import type { BlockStructure } from "../block/scanner.ts";
import type { InlineProfile } from "../inline/profile.ts";
import type { InlineRegionCursor } from "../inline/region.ts";
import type { SourceLocator, SourcePosition } from "../source-view.ts";
import type { InlineBuildContext } from "./inline.ts";

export interface BlockBuildContext {
  // Inline regions build serially, so this context can be rebound for each region.
  inlineContext: InlineBuildContext | undefined;
  locator: SourceLocator;
  structure: BlockStructure;
  cursor: InlineRegionCursor;
  profile: InlineProfile;
  source: string;
}

// Core owns build traversal; profiles supply every syntax-specific node builder.
export type BlockNodeBuilder<T extends object = RootContent> = (
  tokenStart: number,
  context: BlockBuildContext,
) => T;

export function blockEnd(tokenStart: number, context: BlockBuildContext): number {
  const tokens = context.structure.tokens;
  const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
  // Structural close tokens include their boundary; semantic content drops its line ending.
  return tokens.nodeLength(close) === 0
    ? tokens.end(close)
    : tokens.contentEnd(context.source, close);
}

export function leafBlockPosition(
  tokenStart: number,
  context: BlockBuildContext,
): SourcePosition {
  const tokens = context.structure.tokens;
  const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
  return context.locator.positionAt(
    tokens.start(tokenStart),
    tokens.contentEnd(context.source, close),
  );
}

export function fencedBlockPosition(
  tokenStart: number,
  block: FencedBlock,
  context: BlockBuildContext,
): SourcePosition {
  const tokens = context.structure.tokens;
  const end = tokens.end(tokenStart);
  const positionEnd = block.closed || end < tokens.sourceLength
    ? blockEnd(tokenStart, context)
    : end;
  return context.locator.positionAt(
    tokens.start(tokenStart) + block.markerOffset,
    positionEnd,
  );
}

export function buildBlockNode<T extends object = TopLevelContent>(
  tokenStart: number,
  context: BlockBuildContext,
): T {
  return context.structure.ruleOf(tokenStart).build!(tokenStart, context) as T;
}

export function buildBlockChildren(
  tokenStart: number,
  context: BlockBuildContext,
): (BlockContent | DefinitionContent)[] {
  const structure = context.structure;
  const tokens = structure.tokens;
  const children: (BlockContent | DefinitionContent)[] = [];
  const tokenEnd = tokenStart + tokens.nodeLength(tokenStart) - 1;
  for (let child = tokenStart + 1; child < tokenEnd;) {
    const length = tokens.nodeLength(child);
    if (length > 0 && structure.ruleOf(child).block) {
      children.push(buildBlockNode(child, context));
    }
    child += length || 1;
  }
  return children;
}
