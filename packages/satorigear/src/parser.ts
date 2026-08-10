import type { Root } from "mdast";
import { createBlockSyntaxParser } from "./block/syntax.ts";
import { type Document, DocumentImpl } from "./document.ts";
import { InlineSyntaxArena } from "./inline/syntax.ts";
import { compileProfile, type SyntaxOptions } from "./profile/index.ts";

export interface Parser {
  createDocument: (source: string) => Document;
  parse: (source: string) => Root;
}

export function createParser(options?: SyntaxOptions): Parser {
  const profile = compileProfile(options);
  // Snapshots own no arena references, so one-shot parses can reuse both parser workspaces.
  // Incremental documents receive independent workspaces below.
  const blockParser = createBlockSyntaxParser();
  const inlineArena = new InlineSyntaxArena(profile.inlineSyntax);
  return {
    createDocument: (source) => new DocumentImpl(
      source,
      profile,
      createBlockSyntaxParser(),
      new InlineSyntaxArena(profile.inlineSyntax),
    ),
    parse: (source) => new DocumentImpl(source, profile, blockParser, inlineArena).snapshot(),
  };
}
