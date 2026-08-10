import { do_not_optimize } from "mitata";
import type { BenchmarkCorpus } from "./corpus.ts";
import type { Engine } from "./engines.ts";

export function fullyRead(node: unknown): number {
  if (!node || typeof node !== "object") {
    return 0;
  }

  const record = node as Record<string, unknown>;
  let fields = 1;
  for (const key in record) {
    const value = record[key];
    fields++;
    if (key === "children" && Array.isArray(value)) {
      for (const child of value) {
        fields += fullyRead(child);
      }
    }
  }
  return fields;
}

export function parseCorpus(engine: Engine, corpus: BenchmarkCorpus, full: boolean): void {
  if (full) {
    for (const source of corpus.documents) {
      const tree = engine.parse(source);
      do_not_optimize(fullyRead(tree));
      do_not_optimize(tree);
    }
  }
  else {
    for (const source of corpus.documents) {
      const tree = engine.parse(source);
      do_not_optimize(tree);
    }
  }
}

export function corpusLabel(corpus: BenchmarkCorpus): string {
  const documents = corpus.documents.length === 1
    ? "1 document"
    : `${corpus.documents.length} documents`;
  return `${corpus.name}, ${corpus.bytes} bytes, ${documents}`;
}
