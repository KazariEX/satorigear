import { bench, run, summary } from "mitata";
import { load } from "./helpers/corpus.ts";
import { createFeatureEngines } from "./helpers/engines.ts";
import { corpusLabel, parseCorpus } from "./helpers/utils.ts";

const engines = createFeatureEngines();
const corpora = load().filter((corpus) => corpus.profile === "features");

for (const corpus of corpora) {
  summary(() => {
    const suffix = corpusLabel(corpus);
    for (const engine of engines) {
      bench(`${engine.name}, parse only (${suffix})`, () => {
        parseCorpus(engine, corpus, false);
      });
    }
  });
  summary(() => {
    const suffix = corpusLabel(corpus);
    for (const engine of engines) {
      bench(`${engine.name}, fully materialized (${suffix})`, () => {
        parseCorpus(engine, corpus, true);
      });
    }
  });
}

await run(
  process.env.BENCHMARK_FORMAT === "json"
    ? { format: { json: { debug: false, samples: false } } }
    : void 0,
);
