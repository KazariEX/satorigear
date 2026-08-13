import type { Root } from "mdast";
import { BlockArena } from "./block/arena.ts";
import { BlockScanner } from "./block/scanner.ts";
import { type Document, DocumentImpl } from "./document.ts";
import { compileProfile, type FeatureOptions } from "./profile/index.ts";

export interface Parser {
  createDocument: (source: string) => Document;
  parse: (source: string) => Root;
}

export interface ParserOptions {
  features?: FeatureOptions;
}

export function createParser(options?: ParserOptions): Parser {
  const profile = compileProfile(options?.features);
  // Snapshots own no syntax references, so one-shot parses can reuse the block workspace.
  // Incremental documents receive an independent workspace below.
  let blockScanner: BlockScanner | undefined;
  let blockArena: BlockArena | undefined;

  return {
    createDocument: (source) => new DocumentImpl(source, profile),
    parse: (source) => {
      blockScanner ??= new BlockScanner(profile.block);
      blockArena ??= new BlockArena(profile.block.schema, blockScanner.tokens);
      return DocumentImpl.parse(
        source,
        profile,
        blockScanner,
        blockArena,
      );
    },
  };
}
