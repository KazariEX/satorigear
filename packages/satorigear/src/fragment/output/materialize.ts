import type { Node, Root, TopLevelContent } from "mdast";
import type { SourceLocation } from "../../source-view.ts";
import type { BlockFragment, SpannedNode, SpannedValue } from "../node.ts";

function materializeNode(value: SpannedValue, locate: (offset: number) => SourceLocation): void {
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

function snapshotNode(
  value: SpannedValue,
  shift: number,
  point: (offset: number) => SourceLocation,
): Node {
  const result = {} as Node & Record<string, unknown>;
  // Preserve start → children → end order for the tokenizer's forward source locator.
  const start = point(shift + value.position.start);
  for (const key in value) {
    if (key !== "children" && key !== "position") {
      result[key] = value[key];
    }
  }
  const childrenTarget = value.children;
  if (childrenTarget) {
    const children = new Array<Node>(childrenTarget.length);
    for (let i = 0; i < childrenTarget.length; i++) {
      children[i] = snapshotNode(childrenTarget[i], shift, point);
    }
    result.children = children;
  }
  result.position = {
    start,
    end: point(shift + value.position.end),
  };
  return result;
}

export function snapshot(
  fragments: readonly BlockFragment[],
  sourceLength: number,
  locate: (offset: number) => SourceLocation,
): Root {
  const start = locate(0);
  const children = fragments.map((fragment) => snapshotNode(
    fragment.node,
    fragment.offset - fragment.origin,
    locate,
  ) as TopLevelContent);
  return {
    type: "root",
    children,
    position: { start, end: locate(sourceLength) },
  };
}
