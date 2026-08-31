import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type BenchmarkCorpus, load } from "../test/benchmark/helpers/corpus.ts";
import { corpusLabel } from "../test/benchmark/helpers/utils.ts";

const engines = ["satorigear", "satteri", "remark"] as const;
const forwarded = ["satorigear", "satteri"] as const;
const backwarded = forwarded.toReversed();
const paired = [forwarded, backwarded, backwarded, forwarded];
const rounds = paired.length;
const maximumRelativeSpread = 0.03;

type Engine = typeof engines[number];

interface MitataRun {
  name: string;
  stats?: { avg: number };
  error?: { message?: string };
}

interface BenchmarkContext {
  arch: string | null;
  runtime: string | null;
  version: string | null;
  cpu: { name: string | null };
}

interface MitataOutput {
  benchmarks: readonly { runs: readonly MitataRun[] }[];
  context: BenchmarkContext;
}

type BenchmarkRound = ReadonlyMap<string, number>;

const root = join(import.meta.dirname, "..");
const readmePath = join(root, "README.md");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const corpora = load();
const engineNames: Record<Engine, string> = {
  remark: "Remark",
  satorigear: "SatoriGear",
  satteri: "Sätteri",
};

function runSuite(file: string, engine: Engine): MitataOutput {
  const result = spawnSync(process.execPath, ["--expose-gc", join(root, file)], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      BENCHMARK_ENGINE: engine,
      BENCHMARK_FORMAT: "json",
    },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`${file} exited with status ${result.status}`);
  }
  return JSON.parse(result.stdout) as MitataOutput;
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.length / 2;
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function addOutput(times: Map<string, number>, output: MitataOutput): void {
  for (const run of output.benchmarks.flatMap((benchmark) => benchmark.runs)) {
    if (run.error || !run.stats) {
      throw new Error(`${run.name}: ${run.error?.message ?? "benchmark produced no statistics"}`);
    }
    if (times.has(run.name)) {
      throw new Error(`Duplicate benchmark result: ${run.name}`);
    }
    times.set(run.name, run.stats.avg);
  }
}

function benchmarkResult(
  roundResults: readonly BenchmarkRound[],
  name: string,
  baselineName: string,
): { relativeTime: number; time: number } | undefined {
  const baselineTimes: number[] = [];
  const relativeTimes: number[] = [];
  const times: number[] = [];
  for (const round of roundResults) {
    const time = round.get(name);
    const baseline = round.get(baselineName);
    if (time === void 0 || baseline === void 0) {
      return;
    }
    baselineTimes.push(baseline);
    relativeTimes.push(time / baseline);
    times.push(time);
  }
  const sortedRelativeTimes = relativeTimes.toSorted((a, b) => a - b);
  const middle = sortedRelativeTimes.length / 2;
  const spread = sortedRelativeTimes[middle] / sortedRelativeTimes[middle - 1] - 1;
  if (spread > maximumRelativeSpread) {
    throw new Error(`${name}: ${(spread * 100).toFixed(1)}% central relative spread`);
  }
  const time = median(times);
  return {
    relativeTime: time / median(baselineTimes),
    time,
  };
}

function formatTime(nanoseconds: number): string {
  const [value, unit] = nanoseconds < 1_000
    ? [nanoseconds, "ns"]
    : nanoseconds < 1_000_000
      ? [nanoseconds / 1_000, "µs"]
      : nanoseconds < 1_000_000_000
        ? [nanoseconds / 1_000_000, "ms"]
        : [nanoseconds / 1_000_000_000, "s"];
  const digits = value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${value.toFixed(digits)} ${unit}`;
}

function formatRelativeSpeed(relativeTime: number): string {
  if (relativeTime === 1) {
    return "baseline";
  }
  return relativeTime < 1
    ? `↑ ${(1 / relativeTime).toFixed(2)}×`
    : `↓ ${relativeTime.toFixed(2)}×`;
}

function formatThroughput(bytes: number, nanoseconds: number): string {
  const throughput = bytes * 1_000_000_000 / nanoseconds / (1024 * 1024);
  const digits = throughput < 10 ? 2 : throughput < 100 ? 1 : 0;
  return `${throughput.toFixed(digits)} MiB/s`;
}

function benchmarkName(engine: Engine, corpus: BenchmarkCorpus): string {
  return `${engine}, parse (${corpusLabel(corpus)})`;
}

function renderCorpus(
  rounds: readonly BenchmarkRound[],
  corpus: BenchmarkCorpus,
): string {
  const baselineName = benchmarkName("satorigear", corpus);
  const lines = [
    `#### ${corpusLabel(corpus)}`,
    "",
    "| Engine | Mean time | vs. SatoriGear | Throughput |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const engine of engines) {
    const name = benchmarkName(engine, corpus);
    const result = benchmarkResult(rounds, name, baselineName);
    if (!result) {
      continue;
    }
    const engineName = engine === "satorigear" ? `**${engineNames[engine]}**` : engineNames[engine];
    lines.push(
      `| ${engineName} | ${formatTime(result.time)} | ${formatRelativeSpeed(result.relativeTime)} | ${formatThroughput(corpus.bytes, result.time)} |`,
    );
  }
  if (lines.length === 4) {
    throw new Error(`Missing benchmark results for ${corpus.name}`);
  }
  return lines.join("\n");
}

function renderProfile(
  rounds: readonly BenchmarkRound[],
  profile: BenchmarkCorpus["profile"],
): string {
  return corpora
    .filter((corpus) => corpus.profile === profile)
    .map((corpus) => renderCorpus(rounds, corpus))
    .join("\n\n");
}

function section(rounds: readonly BenchmarkRound[]): string {
  return [
    "### CommonMark",
    "",
    renderProfile(rounds, "commonmark"),
    "",
    "### Built-in features",
    "",
    renderProfile(rounds, "features"),
  ].join("\n");
}

function replaceSection(source: string, name: string, content: string): string {
  const start = `<!-- benchmark:start ${name} -->`;
  const end = `<!-- benchmark:end -->`;
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`README is missing the ${JSON.stringify(name)} benchmark markers`);
  }
  return `${source.slice(0, startIndex + start.length)}\n\n${content}\n\n${source.slice(endIndex)}`;
}

const times = Array.from({ length: rounds }, () => new Map<string, number>());
const suites = [
  { file: "test/benchmark/parse.bench.ts", references: ["remark"] },
  { file: "test/benchmark/features.bench.ts", references: [] },
] as const;

let context: BenchmarkContext | undefined;
for (const suite of suites) {
  console.log(`Benchmarking ${suite.file}`);
  for (const [round, order] of paired.entries()) {
    console.log(`  paired round ${round + 1}/${rounds}`);
    for (const engine of order) {
      const output = runSuite(suite.file, engine);
      context ??= output.context;
      addOutput(times[round], output);
    }
  }
}
// Keep slower reference engines outside the compared engines' thermal chain.
for (const suite of suites) {
  console.log(`Benchmarking ${suite.file}`);
  for (const engine of suite.references) {
    for (let round = 0; round < rounds; round++) {
      console.log(`  ${engine} round ${round + 1}/${rounds}`);
      addOutput(times[round], runSuite(suite.file, engine));
    }
  }
}
if (context === void 0) {
  throw new Error("No benchmark results");
}

let readme = readFileSync(readmePath, "utf8");
const { arch, cpu, runtime, version } = context;
readme = replaceSection(
  readme,
  "environment",
  `> Median of ${rounds} isolated mean-time runs at commit [\`${commit.slice(0, 7)}\`](https://github.com/KazariEX/satorigear/commit/${commit}) on ${cpu.name}, ${runtime} ${version}, ${arch}. SatoriGear and Sätteri run in paired AB/BA order; comparisons are normalized to SatoriGear (↑ faster, ↓ slower). Lower time and higher throughput are better.`,
);
readme = replaceSection(readme, "parse", section(times));
writeFileSync(readmePath, readme);
