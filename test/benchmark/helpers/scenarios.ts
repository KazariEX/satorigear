import type { TextEdit } from "satorigear";
import type { BenchmarkCorpus } from "./corpus.ts";

export interface EditScenario {
  name: string;
  before: string;
  after: string;
}

function documentOf(corpora: readonly BenchmarkCorpus[], id: string): string {
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

export function editBetween(source: string, nextSource: string): TextEdit {
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

export function createEditScenarios(corpora: readonly BenchmarkCorpus[]): readonly EditScenario[] {
  const commonmarkSpec = documentOf(corpora, "commonmark-spec-0.31.2");
  const rustReleases = documentOf(corpora, "rust-releases");
  const publicApis = documentOf(corpora, "public-apis-readme");
  const referenceWithoutDefinition = `${rustReleases}\n\nA [benchmark reference][target].\n`;
  return [
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
}
