export type AttributeValue = string;
export type Attributes = Record<string, AttributeValue>;

declare module "mdast" {
  interface Node {
    attributes?: Attributes;
  }
}
