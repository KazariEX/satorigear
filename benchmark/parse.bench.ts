import { Buffer } from "node:buffer";
import { tests } from "commonmark-spec";
import { bench, do_not_optimize, run, summary } from "mitata";
import { remark } from "remark";
import { createParser } from "satorigear";
import { markdownToMdast as parseSatteri } from "satteri";
import { force } from "./utils.ts";

const representative = `# Parser benchmark

This paragraph contains *emphasis*, **strong text**, an [inline link](/target "title"),
and a [reference][docs] with an &amp; entity.

> A block quote with two lines
> and a hard break.

1. An ordered item
2. Another item with \`inline code\`
   - and a nested list

\`\`\`ts
const result = parse("source");
\`\`\`

[docs]: https://example.com/docs "Documentation"
`;

const corpus = (tests)
  .map((test) => test.markdown.replace(/→/g, "\t"))
  .join("\n\n");

const delimiterStress = `${"a**a ".repeat(1_000)}${"a* ".repeat(1_000)}`;

const inputs = [
  { name: "representative document", source: representative },
  { name: "official corpus as one document", source: corpus },
  { name: "delimiter stress document", source: delimiterStress },
];

const parseSatorigear = createParser().parse;

const processor = remark();
const parseRemark = processor.parse.bind(processor);

const satteriOptions = {
  features: {
    frontmatter: false,
    gfm: false,
  },
} as const;

for (const input of inputs) {
  summary(() => {
    const suffix = `${input.name}, ${Buffer.byteLength(input.source)} bytes`;

    for (
      const [name, parse] of [
        ["satorigear", parseSatorigear.bind(void 0, input.source)],
        ["remark", parseRemark.bind(void 0, input.source)],
        ["satteri", parseSatteri.bind(void 0, input.source, satteriOptions)],
      ] as const
    ) {
      bench(`${name}, snapshot (${suffix})`, () => {
        const tree = parse();
        do_not_optimize(tree);
      });
      bench(`${name}, fully read (${suffix})`, () => {
        const tree = parse();
        force(tree);
        do_not_optimize(tree);
      });
    }
  });
}

await run();
