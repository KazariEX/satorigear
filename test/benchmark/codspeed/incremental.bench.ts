import { describe, test } from "vitest";
import { createParser } from "satorigear";
import { load } from "../helpers/corpus.ts";
import { createEditScenarios, editBetween } from "../helpers/scenarios.ts";

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
const scenarios = createEditScenarios(load());

describe("incremental", () => {
  for (const scenario of scenarios) {
    test(scenario.name, async ({ bench }) => {
      const sources = [scenario.before, scenario.after] as const;
      const edits = [
        editBetween(sources[0], sources[1]),
        editBetween(sources[1], sources[0]),
      ] as const;
      let editIndex = 0;
      let freshIndex = 1;
      const editDocument = parser.createDocument(sources[0]);

      await bench.compare(
        bench("edit only", () => {
          editDocument.edit([edits[editIndex]]);
          editIndex ^= 1;
        }),
        bench("fresh tree", () => {
          void parser.createDocument(sources[freshIndex]).tree;
          freshIndex ^= 1;
        }),
      );
    });
  }
});
