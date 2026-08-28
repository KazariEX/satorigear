import { bench, do_not_optimize, run, summary } from "mitata";
import { createParser } from "satorigear";
import { load } from "./helpers/corpus.ts";
import { createCommonmarkEngines } from "./helpers/engines.ts";
import { corpusLabel, parseCorpus } from "./helpers/utils.ts";

const engines = createCommonmarkEngines();
const corpora = load().filter((corpus) => corpus.profile === "commonmark");

if (process.env.BENCHMARK_ENGINE === void 0 || process.env.BENCHMARK_ENGINE === "satorigear") {
  // Parser (profile) construction is intentionally separate from steady-state document parsing.
  summary(() => {
    bench("satorigear, create parser", () => {
      do_not_optimize(createParser());
    });
  });
}

for (const corpus of corpora) {
  summary(() => {
    const suffix = corpusLabel(corpus);
    for (const engine of engines) {
      bench(`${engine.name}, parse (${suffix})`, () => {
        parseCorpus(engine, corpus);
      });
    }
  });
}

await run(
  process.env.BENCHMARK_FORMAT === "json"
    ? { format: { json: { debug: false, samples: false } } }
    : void 0,
);
