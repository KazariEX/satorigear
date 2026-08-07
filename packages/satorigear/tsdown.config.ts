import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { minify } from "rolldown/utils";
import { defineConfig } from "tsdown";
import { markdownBlockGrammar } from "./src/grammar-blocks.ts";
import { markdownInlineGrammar } from "./src/grammar-inline.ts";

export default defineConfig({
  exports: true,
  plugins: [
    {
      name: "generate-parser",
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
            const emitted = emitJsParser(grammar, emitJsLexer(grammar));
            const minified = await minify("testify.ts", emitted);
            await writeFile(join(generated, name), `// @ts-nocheck\n${minified.code}`);
          }),
        );
      },
    },
  ],
});
