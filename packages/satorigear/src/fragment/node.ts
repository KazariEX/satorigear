import type { Node, TopLevelContent } from "mdast";
import type { SourceSpan } from "../source-view.ts";

// Builders store source offsets in the final position slot. One-shot output resolves it in place;
// incremental documents retain it as the immutable span of a cached block fragment.
export interface SpannedValue {
  [key: string]: unknown;
  children?: SpannedValue[];
  position: SourceSpan;
}

export type SpannedNode<T extends object = Node> = T & SpannedValue;

export interface BlockFragment {
  node: SpannedNode<TopLevelContent>;
  // Origin belongs to the cached fragment; offset moves so positions can shift without rebuilding nodes.
  offset: number;
  origin: number;
  version: number;
}

export function withSpan<const T extends object>(value: T, start: number, end: number): SpannedNode<T> {
  const node = value as SpannedNode<T>;
  node.position = { start, end };
  return node;
}

export function extendSpan(value: object, end: number): void {
  const node = value as SpannedValue;
  node.position.end = Math.max(node.position.end, end);
}

export function firstChildStart(value: { children: readonly object[] }): number {
  const first = value.children[0];
  if (!first) {
    throw new Error("mdast container unexpectedly has no children");
  }
  return (first as SpannedValue).position.start;
}

export function lastChildEnd(value: { children: readonly object[] }, emptyEnd: number): number {
  const last = value.children.at(-1);
  return last ? (last as SpannedValue).position.end : emptyEnd;
}
