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
      bench(`${engine.name}, parse return (${suffix})`, () => {
        parseCorpus(engine, corpus, false);
      });
    }
  });
  summary(() => {
    const suffix = corpusLabel(corpus);
    for (const engine of engines) {
      bench(`${engine.name}, fully read (${suffix})`, () => {
        parseCorpus(engine, corpus, true);
      });
    }
  });
}

await run();
