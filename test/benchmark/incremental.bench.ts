import { Buffer } from "node:buffer";
import { bench, do_not_optimize, run, summary } from "mitata";
import { createParser, type TextEdit } from "satorigear";
import { load } from "./helpers/corpus.ts";
import { fullyRead } from "./helpers/utils.ts";

interface EditScenario {
  name: string;
  first: string;
  second: string;
}

const parser = createParser();
const oxContent = load().find((corpus) => corpus.id === "ox-content-readme");
const base = oxContent?.documents[0];
if (base === void 0) {
  throw new Error("Ox Content benchmark corpus is unavailable");
}

function replaceOnce(source: string, search: string, replacement: string): string {
  const start = source.indexOf(search);
  if (start < 0) {
    throw new Error(`Benchmark fixture does not contain ${JSON.stringify(search)}`);
  }
  return `${source.slice(0, start)}${replacement}${source.slice(start + search.length)}`;
}

function editBetween(source: string, next: string): TextEdit {
  const common = Math.min(source.length, next.length);
  let start = 0;
  while (start < common &&
    source[start] === next[start]
  ) {
    start++;
  }
  let suffix = 0;
  while (
    suffix < common - start &&
    source[source.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }
  return {
    start,
    end: source.length - suffix,
    text: next.slice(start, next.length - suffix),
  };
}

const referenceWithoutDefinition = `${base}\n\nA [benchmark reference][target].\n`;
const scenarios: readonly EditScenario[] = [
  {
    name: "single title character",
    first: base,
    second: replaceOnce(base, "High-performance", "high-performance"),
  },
  {
    name: "document-start newline",
    first: base,
    second: `\n${base}`,
  },
  {
    name: "fence closer to text",
    first: base,
    second: replaceOnce(base, "\n```\n", "\n``x\n"),
  },
  {
    name: "list indentation",
    first: base,
    second: replaceOnce(base, "\n- **Blazing Fast**", "\n    - **Blazing Fast**"),
  },
  {
    name: "definition availability",
    first: referenceWithoutDefinition,
    second: `${referenceWithoutDefinition}\n[target]: /url\n`,
  },
];

summary(() => {
  const document = parser.createDocument(base);
  document.snapshot();

  bench(`cached snapshot (${Buffer.byteLength(base)} bytes)`, () => {
    do_not_optimize(document.snapshot());
  });
  bench(`cached snapshot fully read (${Buffer.byteLength(base)} bytes)`, () => {
    const tree = document.snapshot();
    do_not_optimize(fullyRead(tree));
    do_not_optimize(tree);
  });
  bench(`fresh parse return (${Buffer.byteLength(base)} bytes)`, () => {
    do_not_optimize(parser.parse(base));
  });
  bench(`fresh fully read (${Buffer.byteLength(base)} bytes)`, () => {
    const tree = parser.parse(base);
    do_not_optimize(fullyRead(tree));
    do_not_optimize(tree);
  });
});

for (const scenario of scenarios) {
  summary(() => {
    const bytes = Math.max(Buffer.byteLength(scenario.first), Buffer.byteLength(scenario.second));
    let editSource = scenario.first;
    const editDocument = parser.createDocument(editSource);
    let snapshotSource = scenario.first;
    const snapshotDocument = parser.createDocument(snapshotSource);
    let fullyReadSource = scenario.first;
    const fullyReadDocument = parser.createDocument(fullyReadSource);
    let freshSource = scenario.first;
    let freshFullyReadSource = scenario.first;

    bench(`edit only (${scenario.name}, ${bytes} bytes)`, () => {
      const next = editSource === scenario.first ? scenario.second : scenario.first;
      do_not_optimize(editDocument.edit([editBetween(editSource, next)]));
      editSource = next;
    });
    bench(`edit and snapshot (${scenario.name}, ${bytes} bytes)`, () => {
      const next = snapshotSource === scenario.first ? scenario.second : scenario.first;
      snapshotDocument.edit([editBetween(snapshotSource, next)]);
      snapshotSource = next;
      do_not_optimize(snapshotDocument.snapshot());
    });
    bench(`edit and fully read (${scenario.name}, ${bytes} bytes)`, () => {
      const next = fullyReadSource === scenario.first ? scenario.second : scenario.first;
      fullyReadDocument.edit([editBetween(fullyReadSource, next)]);
      fullyReadSource = next;
      const tree = fullyReadDocument.snapshot();
      do_not_optimize(fullyRead(tree));
      do_not_optimize(tree);
    });
    bench(`fresh parse return (${scenario.name}, ${bytes} bytes)`, () => {
      freshSource = freshSource === scenario.first ? scenario.second : scenario.first;
      do_not_optimize(parser.parse(freshSource));
    });
    bench(`fresh fully read (${scenario.name}, ${bytes} bytes)`, () => {
      freshFullyReadSource = freshFullyReadSource === scenario.first ? scenario.second : scenario.first;
      const tree = parser.parse(freshFullyReadSource);
      do_not_optimize(fullyRead(tree));
      do_not_optimize(tree);
    });
  });
}

await run();
