import type { Node, Root, TopLevelContent } from "mdast";
import type { SourceLocation } from "../../source-view.ts";
import type { SpannedNode, SpannedValue } from "../node.ts";

export function materializeNode(
  value: SpannedValue,
  locate: (offset: number) => SourceLocation,
): void {
  const position = value.position;
  const start = locate(position.start);
  const end = position.end;
  for (const child of value.children ?? []) {
    materializeNode(child, locate);
  }
  const result = position as unknown as NonNullable<Node["position"]>;
  result.start = start;
  result.end = locate(end);
}

export function materialize(
  nodes: SpannedNode<TopLevelContent>[],
  sourceLength: number,
  locate: (offset: number) => SourceLocation,
): Root {
  const start = locate(0);
  for (let index = 0; index < nodes.length; index++) {
    materializeNode(nodes[index], locate);
  }
  return {
    type: "root",
    children: nodes as unknown as TopLevelContent[],
    position: { start, end: locate(sourceLength) },
  };
}

export function relocateNode(
  value: object,
  shift: number,
  locate: (offset: number) => SourceLocation,
): void {
  const node = value as {
    children?: object[];
    position: { end: SourceLocation; start: SourceLocation };
  };
  const position = node.position;
  const start = locate(position.start.offset + shift);
  for (const child of node.children ?? []) {
    relocateNode(child, shift, locate);
  }
  position.start = start;
  position.end = locate(position.end.offset + shift);
}
