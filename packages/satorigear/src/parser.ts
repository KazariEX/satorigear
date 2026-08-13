import type { Root } from "mdast";
import { BlockArena } from "./block/arena.ts";
import { BlockScanner } from "./block/scanner.ts";
import { type Document, DocumentImpl } from "./document.ts";
import { compileProfile, type SyntaxOptions } from "./profile/index.ts";

export interface Parser {
  createDocument: (source: string) => Document;
  parse: (source: string) => Root;
}

export function createParser(options?: SyntaxOptions): Parser {
  const profile = compileProfile(options);
  // Snapshots own no syntax references, so one-shot parses can reuse the block workspace.
  // Incremental documents receive an independent workspace below.
  let blockScanner: BlockScanner | undefined;
  let blockArena: BlockArena | undefined;
  let document: DocumentImpl | undefined;
  return {
    createDocument: (source) => {
      const document = new DocumentImpl(
        profile,
        new BlockScanner(profile.block),
        new BlockArena(profile.block.schema),
      );
      document.initialize(source);
      return document;
    },
    parse: (source) => {
      document ??= new DocumentImpl(
        profile,
        blockScanner ??= new BlockScanner(profile.block),
        blockArena ??= new BlockArena(profile.block.schema),
      );
      document.initialize(source);
      return document.materialize();
    },
  };
}
