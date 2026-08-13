import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type BenchmarkCorpus, load } from "../test/benchmark/helpers/corpus.ts";
import { corpusLabel } from "../test/benchmark/helpers/utils.ts";

const modes = ["parse only", "fully materialized"] as const;
const engines = ["satorigear", "satteri", "remark"] as const;
const rounds = 5;

type BenchmarkMode = typeof modes[number];
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

const root = join(import.meta.dirname, "..");
const readmePath = join(root, "README.md");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const corpora = load();
const engineNames: Record<Engine, string> = {
  remark: "Remark",
  satorigear: "SatoriGear",
  satteri: "Sätteri",
};

function runBenchmark(file: string): MitataOutput {
  const result = spawnSync(process.execPath, ["--expose-gc", join(root, file)], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, BENCHMARK_FORMAT: "json" },
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

function collectTimes(outputs: readonly MitataOutput[]): Map<string, number> {
  const samples = new Map<string, number[]>();
  for (const output of outputs) {
    for (const trial of output.benchmarks) {
      for (const run of trial.runs) {
        if (run.error || !run.stats) {
          throw new Error(`${run.name}: ${run.error?.message ?? "benchmark produced no statistics"}`);
        }
        const values = samples.get(run.name);
        if (values) {
          values.push(run.stats.avg);
        }
        else {
          samples.set(run.name, [run.stats.avg]);
        }
      }
    }
  }
  return new Map([...samples].map(([name, values]) => {
    values.sort((a, b) => a - b);
    return [name, values[Math.floor(values.length / 2)]];
  }));
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

function formatRelativeSpeed(time: number, baseline: number): string {
  if (time === baseline) {
    return "baseline";
  }
  return time < baseline
    ? `↑ ${(baseline / time).toFixed(2)}×`
    : `↓ ${(time / baseline).toFixed(2)}×`;
}

function formatThroughput(bytes: number, nanoseconds: number): string {
  const throughput = bytes * 1_000_000_000 / nanoseconds / (1024 * 1024);
  const digits = throughput < 10 ? 2 : throughput < 100 ? 1 : 0;
  return `${throughput.toFixed(digits)} MiB/s`;
}

function benchmarkName(engine: Engine, mode: BenchmarkMode, corpus: BenchmarkCorpus): string {
  return `${engine}, ${mode} (${corpusLabel(corpus)})`;
}

function renderCorpus(
  times: ReadonlyMap<string, number>,
  mode: BenchmarkMode,
  corpus: BenchmarkCorpus,
): string {
  const baseline = times.get(benchmarkName("satorigear", mode, corpus));
  if (baseline === void 0) {
    throw new Error(`Missing SatoriGear baseline for ${corpus.name}`);
  }
  const lines = [
    `##### ${corpusLabel(corpus)}`,
    "",
    "| Engine | Mean time | vs. SatoriGear | Throughput |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const engine of engines) {
    const time = times.get(benchmarkName(engine, mode, corpus));
    if (time === void 0) {
      continue;
    }
    const engineName = engine === "satorigear" ? `**${engineNames[engine]}**` : engineNames[engine];
    lines.push(
      `| ${engineName} | ${formatTime(time)} | ${formatRelativeSpeed(time, baseline)} | ${formatThroughput(corpus.bytes, time)} |`,
    );
  }
  return lines.join("\n");
}

function renderProfile(
  times: ReadonlyMap<string, number>,
  mode: BenchmarkMode,
  profile: BenchmarkCorpus["profile"],
): string {
  return corpora
    .filter((corpus) => corpus.profile === profile)
    .map((corpus) => renderCorpus(times, mode, corpus))
    .join("\n\n");
}

function section(times: ReadonlyMap<string, number>, mode: BenchmarkMode): string {
  return [
    "<details>",
    `<summary><strong>${mode === "parse only" ? "Parse only" : "Fully materialized"}</strong></summary>`,
    "",
    "#### CommonMark",
    "",
    renderProfile(times, mode, "commonmark"),
    "",
    "#### Built-in features",
    "",
    renderProfile(times, mode, "features"),
    "",
    "</details>",
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

const outputs: MitataOutput[] = [];
for (let round = 1; round <= rounds; round++) {
  console.log(`Benchmark round ${round}/${rounds}`);
  outputs.push(
    runBenchmark("test/benchmark/parse.bench.ts"),
    runBenchmark("test/benchmark/features.bench.ts"),
  );
}
const times = collectTimes(outputs);
let readme = readFileSync(readmePath, "utf8");
const { arch, cpu, runtime, version } = outputs[0].context;
readme = replaceSection(
  readme,
  "environment",
  `> Median of ${rounds} mean-time runs at commit [\`${commit.slice(0, 7)}\`](https://github.com/KazariEX/satorigear/commit/${commit}) on ${cpu.name}, ${runtime} ${version}, ${arch}. Comparisons are relative to SatoriGear (↑ faster, ↓ slower); lower time and higher throughput are better.`,
);
for (const mode of modes) {
  readme = replaceSection(readme, mode, section(times, mode));
}
writeFileSync(readmePath, readme);
