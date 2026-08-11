import type { PhrasingContent } from "mdast";
import { assignAttribute } from "./syntax.ts";
import type { Attributes } from "./types.ts";

// Build-local children carry terminal attributes to block decorators without exposing AST state.
const terminalAttributes = Symbol("terminalAttributes");

type AttributeChildren = PhrasingContent[] & {
  [terminalAttributes]?: Attributes;
};

export function mergeAttributes(target: Attributes, source: Attributes): void {
  for (const key in source) {
    assignAttribute(target, key, source[key]);
  }
}

export function carryTerminalAttributes(children: PhrasingContent[], attributes: Attributes): void {
  const target = children as AttributeChildren;
  if (target[terminalAttributes]) {
    mergeAttributes(target[terminalAttributes], attributes);
  }
  else {
    target[terminalAttributes] = attributes;
  }
}

export function hasTerminalAttributes(children: PhrasingContent[]): boolean {
  return terminalAttributes in children;
}

export function takeTerminalAttributes(children: PhrasingContent[]): Attributes | undefined {
  const target = children as AttributeChildren;
  const attributes = target[terminalAttributes];
  if (attributes) {
    delete target[terminalAttributes];
  }
  return attributes;
}
