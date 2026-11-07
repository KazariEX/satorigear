import { createParser } from "satorigear";
import { describe, it } from "vitest";
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
  it("create", async ({ bench }) => {
    await bench("create parser (default features)", () => {
      createParser();
    }).run();
    await bench("create parser (all features)", () => {
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
    }).run();
  });
});

describe("parse", () => {
  for (const corpus of corpora) {
    const parser = corpus.profile === "commonmark" ? commonmarkParser : featureParser;
    it(`${corpus.profile}: ${corpus.name}`, async ({ bench }) => {
      await bench(`parse ${corpus.id}`, () => {
        for (const source of corpus.documents) {
          parser.parse(source);
        }
      }).run();
    });
  }
});
