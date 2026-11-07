import { describe, test } from "vitest";
import { createParser } from "satorigear";

const delimiterStress = `${"a**a ".repeat(1_000)}${"a* ".repeat(1_000)}`;

const mdcSection = `
::Card{tone=info .wide}
#header{.title}
Header with :smile: and **strong**{.bold} text.

Body with [span]{.mark}, :Badge[text]{type=tip}, \`code\`{lang=ts} and {{ binding.value }}.

- [x] done [link](https://example.com){target=_blank}
- [ ] todo ~~removed~~ $x^2$
::

| Name | Value |
| :--- | ---: |
| :Icon{name=star} | {{ row.value }} |

A footnote reference[^note].

[^note]: Footnote with *emphasis*{.em}.
`;
const mdcDocument = `---\ntitle: Benchmark\n---\n${mdcSection.repeat(200)}`;

const defaultParser = createParser();
const mdcParser = createParser({
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

describe("syntax", () => {
  test("delimiter stress", async ({ bench }) => {
    await bench("commonmark", () => {
      defaultParser.parse(delimiterStress);
    }).run();
  });

  test("mdc document", async ({ bench }) => {
    await bench("all features", () => {
      mdcParser.parse(mdcDocument);
    }).run();
  });
});
