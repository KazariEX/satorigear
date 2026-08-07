import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitJsLexer, emitJsParser } from "monogram/emit-parser.ts";
import { markdownBlockGrammar } from "../packages/satorigear/src/grammar-blocks.ts";
import { markdownInlineGrammar } from "../packages/satorigear/src/grammar-inline.ts";
import markdownGrammar from "../packages/satorigear/src/grammar.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const generated = join(root, "packages/satorigear/src/generated");
const parsers = [
  ["blocks.ts", markdownBlockGrammar],
  ["inline.ts", markdownInlineGrammar],
  ["markdown.ts", markdownGrammar],
];

await mkdir(generated, { recursive: true });
await Promise.all(parsers.map(([name, grammar]) => {
  const source = `// @ts-nocheck\n${emitJsParser(grammar, emitJsLexer(grammar))}`;
  return writeFile(join(generated, name), source);
}));
