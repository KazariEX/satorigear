import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { minify } from "rolldown/utils";
import { defineConfig } from "tsdown";
import { markdownBlockGrammar } from "./src/grammars/blocks.ts";
import { markdownInlineGrammar } from "./src/grammars/inline.ts";

export default defineConfig({
  exports: true,
  hash: false,
  outputOptions: {
    codeSplitting: {
      groups: [
        {
          name: "generated/blocks",
          test: /[\\/]src[\\/]generated[\\/]blocks\.ts$/,
        },
        {
          name: "generated/inline",
          test: /[\\/]src[\\/]generated[\\/]inline\.ts$/,
        },
      ],
    },
  },
  plugins: [
    {
      name: "emit-parser",
      async buildStart() {
        // keep the generator outside tsconfig graph to avoid TS6133 error
        const { emitJsLexer, emitJsParser } = await import("monogram/emit-parser.ts" as any);

        const generated = join(import.meta.dirname, "src/generated");
        const parsers = [
          ["blocks.ts", markdownBlockGrammar],
          ["inline.ts", markdownInlineGrammar],
        ] as const;

        await mkdir(generated, { recursive: true });
        await Promise.all(
          parsers.map(async ([name, grammar]) => {
            const lexer = emitJsLexer(grammar);
            if (lexer === null) {
              throw new Error(`Expected an emitted lexer for ${grammar.name}`);
            }
            const emitted = emitJsParser(grammar, lexer);
            await writeFile(join(generated, name), `// @ts-nocheck\n${emitted}`);
          }),
        );
      },
      generateBundle: {
        order: "post",
        async handler(options, bundle) {
          await Promise.all(
            Object.values(bundle).map(async (chunk) => {
              if (
                chunk.type !== "chunk" ||
                chunk.moduleIds.every((id) => !/[\\/]src[\\/]generated[\\/]/.test(id))
              ) {
                return;
              }
              // Keep the public entry readable while compacting generated parser payloads.
              chunk.code = (await minify(chunk.fileName, chunk.code)).code;
            }),
          );
        },
      },
    },
  ],
});
