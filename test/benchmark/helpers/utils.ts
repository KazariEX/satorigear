import { do_not_optimize } from "mitata";
import type { BenchmarkCorpus } from "./corpus.ts";
import type { Engine } from "./engines.ts";

export function parseCorpus(engine: Engine, corpus: BenchmarkCorpus): void {
  for (const source of corpus.documents) {
    do_not_optimize(engine.parse(source));
  }
}

export function corpusLabel(corpus: BenchmarkCorpus): string {
  const documents = corpus.documents.length === 1
    ? "1 document"
    : `${corpus.documents.length} documents`;
  return `${corpus.name}, ${corpus.bytes} bytes, ${documents}`;
}
