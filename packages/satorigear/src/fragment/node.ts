import type { Node, TopLevelContent } from "mdast";
import type { SourceSpan } from "../source-view.ts";

// Builders store source offsets in the final position slot. One-shot output resolves it in place;
// incremental documents retain it as the immutable span of a cached block fragment.
export interface SpannedValue {
  [key: string]: unknown;
  children?: SpannedValue[];
  position: SourceSpan;
}

export type SpannedNode<T extends object = Node> = T extends unknown
  ? Omit<T, "children" | "position"> & { position: SourceSpan } & (
    T extends { children: readonly object[] }
      ? { children: SpannedNode<T["children"][number]>[] }
      : unknown
  )
  : never;

export interface BlockFragment {
  node: SpannedNode<TopLevelContent>;
  // Origin belongs to the cached fragment; offset moves so positions can shift without rebuilding nodes.
  offset: number;
  origin: number;
  version: number;
}

export function extendSpan(value: object, end: number): void {
  const node = value as SpannedValue;
  node.position.end = Math.max(node.position.end, end);
}

export function firstChildStart(children: readonly SpannedValue[]): number {
  const first = children[0];
  if (!first) {
    throw new Error("mdast container unexpectedly has no children");
  }
  return first.position.start;
}

export function lastChildEnd(children: readonly SpannedValue[], emptyEnd: number): number {
  const last = children.at(-1);
  return last ? last.position.end : emptyEnd;
}
