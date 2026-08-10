import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface RawBenchmarkCorpus {
  id: string;
  name: string;
  file: string;
  format: "markdown" | "commonmark";
  download: string;
}

export interface BenchmarkCorpus extends RawBenchmarkCorpus {
  documents: readonly string[];
  bytes: number;
}

interface CommonMarkExample {
  markdown: string;
}

export const rawCorpora: readonly RawBenchmarkCorpus[] = [
  {
    id: "markdown-exit-readme",
    name: "markdown-exit README",
    file: "markdown-exit.md",
    format: "markdown",
    download: "https://raw.githubusercontent.com/serkodev/markdown-exit/1c1c7cb/README.md",
  },
  {
    id: "ox-content-readme",
    name: "Ox Content README",
    file: "ox-content.md",
    format: "markdown",
    download: "https://raw.githubusercontent.com/ubugeeei-prod/ox-content/bf62928/README.md",
  },
  {
    id: "commonmark-0.31.2",
    name: "CommonMark 0.31.2 examples",
    file: "commonmark.json",
    format: "commonmark",
    download: "https://spec.commonmark.org/0.31.2/spec.json",
  },
];

export function load(): readonly BenchmarkCorpus[] {
  return rawCorpora.map((corpus) => {
    const path = join(import.meta.dirname, `../../corpus/${corpus.file}`);
    const source = readFileSync(path, "utf8");
    const documents = corpus.format === "commonmark"
      ? (JSON.parse(source) as CommonMarkExample[]).map((example) => example.markdown)
      : [source];
    return {
      ...corpus,
      documents,
      bytes: documents.reduce((total, document) => total + Buffer.byteLength(document), 0),
    };
  });
}
