export type AttributeValue =
  | string
  | number
  | boolean
  | null
  | AttributeValue[]
  | { [key: string]: AttributeValue };

export type Attributes = Record<string, AttributeValue>;

declare module "mdast" {
  interface Node {
    attributes?: Attributes;
  }
}
