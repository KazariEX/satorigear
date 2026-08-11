import type { Root } from "mdast";
import { BlockSyntaxArena } from "./block/syntax.ts";
import { type Document, DocumentImpl } from "./document.ts";
import { InlineSyntaxArena } from "./inline/syntax.ts";
import { compileProfile, type SyntaxOptions } from "./profile/index.ts";

export interface Parser {
  createDocument: (source: string) => Document;
  parse: (source: string) => Root;
}

export function createParser(options?: SyntaxOptions): Parser {
  const profile = compileProfile(options);
  // Snapshots own no arena references, so one-shot parses can reuse both workspaces.
  // Incremental documents receive independent workspaces below.
  const blockArena = new BlockSyntaxArena(profile.blockSyntax);
  const inlineArena = new InlineSyntaxArena(profile.inlineSyntax);
  return {
    createDocument: (source) => new DocumentImpl(
      source,
      profile,
      new BlockSyntaxArena(profile.blockSyntax),
      new InlineSyntaxArena(profile.inlineSyntax),
    ),
    parse: (source) => new DocumentImpl(source, profile, blockArena, inlineArena).snapshot(),
  };
}
