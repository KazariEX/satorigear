import { Buffer } from "node:buffer";
import { bench, do_not_optimize, run, summary } from "mitata";
import { createParser } from "satorigear";
import { load } from "./helpers/corpus.ts";
import { createEditScenarios, editBetween } from "./helpers/scenarios.ts";

const parser = createParser({
  features: {
    footnote: true,
    frontmatter: true,
    math: true,
    strikethrough: true,
    table: true,
    taskList: true,
  },
});
const corpora = load();
const scenarios = createEditScenarios(corpora);

for (const scenario of scenarios) {
  summary(() => {
    const sources = [scenario.before, scenario.after] as const;
    const bytes = Math.max(Buffer.byteLength(sources[0]), Buffer.byteLength(sources[1]));
    const edits = [
      editBetween(sources[0], sources[1]),
      editBetween(sources[1], sources[0]),
    ] as const;
    let editIndex = 0;
    let freshIndex = 1;
    const editDocument = parser.createDocument(sources[0]);

    bench(`edit only (${scenario.name}, ${bytes} bytes)`, () => {
      do_not_optimize(editDocument.edit([edits[editIndex]]));
      editIndex ^= 1;
    });
    bench(`fresh tree (${scenario.name}, ${bytes} bytes)`, () => {
      do_not_optimize(parser.createDocument(sources[freshIndex]).tree);
      freshIndex ^= 1;
    });
  });
}

await run();
