import { Buffer } from "node:buffer";
import { tests } from "commonmark-spec";
import { bench, do_not_optimize, run, summary } from "mitata";
import { remark } from "remark";
import { parse as parseSatorigear } from "satorigear";
import { markdownToMdast as parseSatteri } from "satteri";

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

const satteriOptions = {
  features: {
    frontmatter: false,
    gfm: false,
  },
} as const;

const processor = remark();
const parseRemark = processor.parse.bind(processor);

for (const input of inputs) {
  summary(() => {
    const suffix = `${input.name}, ${Buffer.byteLength(input.source)} bytes`;

    bench(`satorigear (${suffix})`, () => {
      do_not_optimize(parseSatorigear(input.source));
    });
    bench(`remark (${suffix})`, () => {
      do_not_optimize(parseRemark(input.source));
    });
    bench(`satteri (${suffix})`, () => {
      do_not_optimize(parseSatteri(input.source, satteriOptions));
    });
  });
}

await run();
