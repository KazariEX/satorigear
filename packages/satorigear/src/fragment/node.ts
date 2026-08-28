import type { Node } from "mdast";
import type { SourceLocation } from "../source-view.ts";

function cloneLocation(location: SourceLocation): SourceLocation {
  return {
    line: location.line,
    column: location.column,
    offset: location.offset,
  };
}

export function firstChildStart(children: readonly Pick<Node, "position">[]): SourceLocation {
  const first = children[0];
  return cloneLocation(first.position!.start as SourceLocation);
}

export function lastChildEnd(children: readonly Pick<Node, "position">[]): SourceLocation | undefined {
  const last = children.at(-1);
  return last ? cloneLocation(last.position!.end as SourceLocation) : void 0;
}
