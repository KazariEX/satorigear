import { Buffer } from "node:buffer";
import { bench, do_not_optimize, run, summary } from "mitata";
import { createParser, type TextEdit } from "satorigear";
import { load } from "./helpers/corpus.ts";

interface EditScenario {
  name: string;
  before: string;
  after: string;
}

const corpora = load();

function documentOf(id: string): string {
  const document = corpora.find((corpus) => corpus.id === id)?.documents[0];
  if (document === void 0) {
    throw new Error(`${id} benchmark corpus is unavailable`);
  }
  return document;
}

function replaceOnce(source: string, search: string, replacement: string): string {
  const start = source.indexOf(search);
  if (start < 0) {
    throw new Error(`Benchmark fixture does not contain ${JSON.stringify(search)}`);
  }
  return `${source.slice(0, start)}${replacement}${source.slice(start + search.length)}`;
}

function editBetween(source: string, nextSource: string): TextEdit {
  const commonLength = Math.min(source.length, nextSource.length);
  let start = 0;
  while (
    start < commonLength &&
    source[start] === nextSource[start]
  ) {
    start++;
  }
  let suffixLength = 0;
  while (
    suffixLength < commonLength - start &&
    source[source.length - 1 - suffixLength] === nextSource[nextSource.length - 1 - suffixLength]
  ) {
    suffixLength++;
  }
  return {
    start,
    end: source.length - suffixLength,
    text: nextSource.slice(start, nextSource.length - suffixLength),
  };
}

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
const commonmarkSpec = documentOf("commonmark-spec-0.31.2");
const rustReleases = documentOf("rust-releases");
const publicApis = documentOf("public-apis-readme");
const referenceWithoutDefinition = `${rustReleases}\n\nA [benchmark reference][target].\n`;
const scenarios: readonly EditScenario[] = [
  {
    name: "middle prose replacement",
    before: commonmarkSpec,
    after: replaceOnce(
      commonmarkSpec,
      "doesn't change the required indentation",
      "does not change the required indentation",
    ),
  },
  {
    name: "fence boundary",
    before: rustReleases,
    after: replaceOnce(rustReleases, "\n```\n", "\n``x\n"),
  },
  {
    name: "table row insertion",
    before: publicApis,
    after: replaceOnce(
      publicApis,
      "|:---|:---|:---|\n",
      "|:---|:---|:---|\n| [Benchmark](https://example.com) | Incremental table row | — |\n",
    ),
  },
  {
    name: "definition availability",
    before: referenceWithoutDefinition,
    after: `${referenceWithoutDefinition}\n[target]: /url\n`,
  },
  {
    name: "tail block append",
    before: commonmarkSpec,
    after: `${commonmarkSpec}\n\nStreaming **append**.\n`,
  },
];

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
