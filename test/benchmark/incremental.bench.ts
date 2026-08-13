import { Buffer } from "node:buffer";
import { bench, do_not_optimize, run, summary } from "mitata";
import { createParser, type TextEdit } from "satorigear";
import { load } from "./helpers/corpus.ts";

interface EditScenario {
  name: string;
  first: string;
  second: string;
}

const parser = createParser();
const rustReleases = load().find((corpus) => corpus.id === "rust-releases");
const base = rustReleases?.documents[0];
if (base === void 0) {
  throw new Error("Rust release history benchmark corpus is unavailable");
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
    second: replaceOnce(base, "Version 1.97.1", "version 1.97.1"),
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
    second: replaceOnce(base, "\n- [rustc:", "\n    - [rustc:"),
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
  bench(`fresh snapshot (${Buffer.byteLength(base)} bytes)`, () => {
    do_not_optimize(parser.createDocument(base).snapshot());
  });
});

for (const scenario of scenarios) {
  summary(() => {
    const bytes = Math.max(Buffer.byteLength(scenario.first), Buffer.byteLength(scenario.second));
    const edits = [
      editBetween(scenario.first, scenario.second),
      editBetween(scenario.second, scenario.first),
    ] as const;
    let editIndex = 0;
    const editDocument = parser.createDocument(scenario.first);
    let snapshotEditIndex = 0;
    const snapshotDocument = parser.createDocument(scenario.first);
    let freshSource = scenario.first;

    bench(`edit only (${scenario.name}, ${bytes} bytes)`, () => {
      do_not_optimize(editDocument.edit([edits[editIndex]]));
      editIndex ^= 1;
    });
    bench(`edit and snapshot (${scenario.name}, ${bytes} bytes)`, () => {
      snapshotDocument.edit([edits[snapshotEditIndex]]);
      snapshotEditIndex ^= 1;
      do_not_optimize(snapshotDocument.snapshot());
    });
    bench(`fresh snapshot (${scenario.name}, ${bytes} bytes)`, () => {
      freshSource = freshSource === scenario.first ? scenario.second : scenario.first;
      do_not_optimize(parser.createDocument(freshSource).snapshot());
    });
  });
}

await run();
