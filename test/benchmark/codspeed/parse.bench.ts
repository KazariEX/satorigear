import { describe, test } from "vitest";
import { createParser } from "satorigear";
import { load } from "../helpers/corpus.ts";

const corpora = load();
const commonmarkParser = createParser();
const featureParser = createParser({
  features: {
    footnote: true,
    frontmatter: true,
    math: true,
    strikethrough: true,
    table: true,
    taskList: true,
  },
});

describe("parser", () => {
  test("create", async ({ bench }) => {
    await bench.compare(
      bench("default features", () => {
        createParser();
      }),
      bench("all features", () => {
        createParser({
          features: {
            attributes: true,
            binding: true,
            component: true,
            emoji: true,
            footnote: true,
            frontmatter: true,
            math: true,
            strikethrough: true,
            table: true,
            taskList: true,
          },
        });
      }),
    );
  });
});

describe("parse", () => {
  for (const corpus of corpora) {
    const parser = corpus.profile === "commonmark" ? commonmarkParser : featureParser;
    test(`${corpus.profile}: ${corpus.name}`, async ({ bench }) => {
      await bench(`${corpus.id} (${corpus.documents.length} documents, ${corpus.bytes} bytes)`, () => {
        for (const source of corpus.documents) {
          parser.parse(source);
        }
      }).run();
    });
  }
});
