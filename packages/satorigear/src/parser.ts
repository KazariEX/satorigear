import type { Root } from "mdast";
import { BlockArena } from "./block/arena.ts";
import { type Document, DocumentImpl } from "./document.ts";
import { compileProfile, type SyntaxOptions } from "./profile/index.ts";

export interface Parser {
  createDocument: (source: string) => Document;
  parse: (source: string) => Root;
}

export function createParser(options?: SyntaxOptions): Parser {
  const profile = compileProfile(options);
  // Snapshots own no arena references, so one-shot parses can reuse the block workspace.
  // Incremental documents receive an independent workspace below.
  const blockArena = new BlockArena(profile.block.schema);
  return {
    createDocument: (source) => new DocumentImpl(
      source,
      profile,
      new BlockArena(profile.block.schema),
    ),
    parse: (source) => new DocumentImpl(source, profile, blockArena).materialize(),
  };
}
