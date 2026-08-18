import type { Node, PhrasingContent, RootContent } from "mdast";
import type { Attributes } from "../attributes/types.ts";

export interface BlockComponent extends Node {
  type: "blockComponent";
  name: string;
  attributes: Attributes;
  children: RootContent[];
}

export interface InlineComponent extends Node {
  type: "inlineComponent";
  name: string;
  attributes: Attributes;
  children: PhrasingContent[];
}

declare module "mdast" {
  interface BlockContentMap {
    blockComponent: BlockComponent;
  }

  interface PhrasingContentMap {
    inlineComponent: InlineComponent;
  }

  interface RootContentMap {
    blockComponent: BlockComponent;
    inlineComponent: InlineComponent;
  }
}
