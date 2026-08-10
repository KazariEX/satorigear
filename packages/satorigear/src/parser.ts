import type { Root } from "mdast";
import { createBlockSyntaxParser } from "./block/syntax.ts";
import { type Document, DocumentImpl } from "./document.ts";
import { compileProfile, type SyntaxOptions } from "./profile/index.ts";

export interface Parser {
  createDocument: (source: string) => Document;
  parse: (source: string) => Root;
}

export function createParser(options?: SyntaxOptions): Parser {
  const profile = compileProfile(options);
  // A snapshot owns no arena references, so one-shot parses can reset and reuse this workspace.
  // Incremental documents receive an independent parser below.
  const blockParser = createBlockSyntaxParser();
  return {
    createDocument: (source) => new DocumentImpl(source, profile, createBlockSyntaxParser()),
    parse: (source) => new DocumentImpl(source, profile, blockParser).snapshot(),
  };
}
