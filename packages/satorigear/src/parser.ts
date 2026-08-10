import type { Root } from "mdast";
import { type Document, DocumentImpl } from "./document.ts";
import { compileProfile, type SyntaxOptions } from "./profile/index.ts";

export interface Parser {
  createDocument: (source: string) => Document;
  parse: (source: string) => Root;
}

export function createParser(options?: SyntaxOptions): Parser {
  const profile = compileProfile(options);
  const createDocument: Parser["createDocument"] = (source) => new DocumentImpl(source, profile);
  return {
    createDocument,
    parse: (source) => createDocument(source).snapshot(),
  };
}
