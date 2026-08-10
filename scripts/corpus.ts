import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rawCorpora } from "../test/benchmark/helpers/corpus.ts";

const directory = join(import.meta.dirname, "../test/corpus/");
await mkdir(directory, { recursive: true });

await Promise.all(
  rawCorpora.map(async (corpus) => {
    const response = await fetch(corpus.download);
    const content = await response.text();
    const path = join(directory, corpus.file);
    await writeFile(path, content);
    console.log(`Downloaded ${corpus.name}`);
  }),
);
