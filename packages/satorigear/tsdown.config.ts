import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { minify } from "rolldown/utils";
import { defineConfig } from "tsdown";
import { grammar as grammarInline } from "./src/grammars/inline.ts";
import { inlineKind } from "./src/inline/kinds.ts";

function verifyInlineKinds(source: string): void {
  const generated = Object.fromEntries(
    [...source.matchAll(/case "([^"]*)": return (\d+);/g)].map((match) => [match[1], Number(match[2])]),
  );
  const fallback = Number(/K_NAMED_FALLBACK = (\d+);/.exec(source)?.[1]);
  for (const [name, kind] of Object.entries(generated)) {
    if (inlineKind(name) !== kind) {
      throw new Error(`Generated inline kind for ${name} does not match the runtime registry`);
    }
  }
  if (inlineKind("InlineBoundary") !== fallback) {
    throw new Error("InlineBoundary does not match the generated fallback kind");
  }
}

export default defineConfig({
  exports: true,
  hash: false,
  outputOptions: {
    codeSplitting: {
      groups: [
        {
          name: "generated/inline",
          test: /[\\/]src[\\/](?:generated[\\/]inline|inline[\\/]kinds)\.ts$/,
        },
      ],
    },
  },
  plugins: [
    {
      name: "emit-parser",
      async buildStart() {
        // keep the generator outside tsconfig graph to avoid TS6133 error
        const { emitJsPackedLexer } = await import("monogram/emit-parser.ts" as any);

        const generated = join(import.meta.dirname, "src/generated");
        const inline = emitJsPackedLexer(grammarInline);
        verifyInlineKinds(inline);
        const modules = [{ name: "inline.ts", source: inline }];

        await mkdir(generated, { recursive: true });
        await Promise.all(
          modules.map(async ({ name, source }) => {
            await writeFile(join(generated, name), `// @ts-nocheck\n${source}`);
          }),
        );
      },
      generateBundle: {
        order: "post",
        async handler(options, bundle) {
          await Promise.all(
            Object.values(bundle).map(async (chunk) => {
              if (
                chunk.type === "chunk" &&
                chunk.moduleIds.some((id) => /[\\/]src[\\/]generated[\\/]/.test(id))
              ) {
                // Keep the public entry readable while compacting generated parser payloads.
                const result = await minify(chunk.fileName, chunk.code);
                chunk.code = result.code;
              }
            }),
          );
        },
      },
    },
  ],
});
