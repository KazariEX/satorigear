import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface RawBenchmarkCorpus {
  id: string;
  name: string;
  file: string;
  format: "markdown" | "json";
  profile: "commonmark" | "features";
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
    id: "commonmark-spec-0.31.2",
    name: "CommonMark 0.31.2 specification",
    file: "commonmark-spec.md",
    format: "markdown",
    profile: "commonmark",
    download: "https://raw.githubusercontent.com/commonmark/commonmark/0.31.2/spec.txt",
  },
  {
    id: "rust-releases",
    name: "Rust release history",
    file: "rust-releases.md",
    format: "markdown",
    profile: "features",
    download: "https://raw.githubusercontent.com/rust-lang/rust/ba28ff76f353a722f31c4f3dd2ac4e437d36411b/RELEASES.md",
  },
  {
    id: "public-apis-readme",
    name: "Public APIs README",
    file: "public-apis.md",
    format: "markdown",
    profile: "features",
    download: "https://raw.githubusercontent.com/public-apis/public-apis/6472943bb66b35b96eecd6820f639656f3304499/README.md",
  },
  {
    id: "commonmark-0.31.2",
    name: "CommonMark 0.31.2 examples",
    file: "commonmark.json",
    format: "json",
    profile: "commonmark",
    download: "https://spec.commonmark.org/0.31.2/spec.json",
  },
];

export function load(): readonly BenchmarkCorpus[] {
  return rawCorpora.map((corpus) => {
    const path = join(import.meta.dirname, `../../corpus/${corpus.file}`);
    const source = readFileSync(path, "utf8");
    const documents = corpus.format === "json"
      ? (JSON.parse(source) as CommonMarkExample[]).map((example) => example.markdown)
      : [source];
    return {
      ...corpus,
      documents,
      bytes: documents.reduce((total, document) => total + Buffer.byteLength(document), 0),
    };
  });
}
