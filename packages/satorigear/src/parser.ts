import type { Root } from "mdast";
import { BlockScanner } from "./block/scanner.ts";
import { BlockStructure } from "./block/structure.ts";
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
  // One-shot trees retain no syntax references, so parses can reuse the block workspace.
  // Incremental documents receive an independent workspace below.
  let blockScanner: BlockScanner | undefined;
  let blockStructure: BlockStructure | undefined;

  return {
    createDocument: (source) => new DocumentImpl(source, profile),
    parse: (source) => {
      blockScanner ??= new BlockScanner(profile.block);
      blockStructure ??= new BlockStructure(profile.block.schema, blockScanner);
      return DocumentImpl.parse(
        source,
        profile,
        blockScanner,
        blockStructure,
      );
    },
  };
}
