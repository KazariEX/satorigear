import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { relative, resolve } from "node:path";
import { performance, PerformanceObserver } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { do_not_optimize } from "mitata";
import { analyzeBlocks, type Observation } from "../test/benchmark/helpers/abba.ts";
import { load } from "../test/benchmark/helpers/corpus.ts";
import { parseCorpus } from "../test/benchmark/helpers/utils.ts";
import type { Parser } from "../packages/satorigear/src/parser.ts";

// A and B are built bundles. Use the literal `remark` only when establishing a fixed reference.
// Example: node --expose-gc scripts/benchmark-abba.ts baseline.mjs candidate.mjs result.json
// Add --reference test/benchmark/reference/remark-node26-m1pro.json when A is the frozen initial bundle.
const self = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    worker: { type: "boolean" },
    blocks: { type: "string", default: "4" },
    control: { type: "boolean" },
    reference: { type: "string" },
    cases: { type: "string", default: "commonmark/spec,commonmark/examples,features/rust,features/apis,incremental/tail" },
  },
});

const corpusIds: Record<string, string> = {
  "commonmark/spec": "commonmark-spec-0.31.2",
  "commonmark/examples": "commonmark-0.31.2",
  "features/rust": "rust-releases",
  "features/apis": "public-apis-readme",
};
const attributeSources: Record<string, string> = {
  "attributes/terminal": "text &#32;{#a}\n\n".repeat(800),
  "attributes/mixed": "text {#a} tail&#32;\n\n".repeat(800),
};
const cases = values.cases.split(",");
assert.ok(cases.every((name) => name in corpusIds || name in attributeSources || name === "incremental/tail"));
assert.equal(new Set(cases).size, cases.length);
const budgetMs = 300;
const maxMs = 500;

interface ReferenceReport {
  status: string;
  cpu: string;
  runtime: string;
  nodeFlags: string[];
  nodeOptions: string | null;
  benchmarkVersion: number;
  budgetMs: number;
  maxMs: number;
  warmupMs: number;
  postGcSettleMs: number;
  paths: { A: string; B: string };
  inputs: Record<string, string>;
  reference?: { engine: string };
  results: Record<string, { summary: ReturnType<typeof analyzeBlocks> }>;
}

async function observe(bundle: string, name: string) {
  assert.ok(globalThis.gc, "Run with --expose-gc");
  const features = { footnote: true, frontmatter: true, math: true, strikethrough: true, table: true, taskList: true };
  const parser: Parser = bundle === "remark"
    ? { parse: (await import("mdast-util-from-markdown")).fromMarkdown } as Parser
    : (await import(pathToFileURL(bundle).href)).createParser({
      features: name.startsWith("commonmark/") ? void 0 : name.startsWith("attributes/") ? { attributes: true } : features,
    });
  const corpora = load();
  let run: () => void;
  let reset = () => {};
  if (name === "incremental/tail") {
    const source = corpora[0].documents[0];
    const tail = "\n\nStreaming **append**.\n";
    let document = parser.createDocument(source);
    let index = 0;
    const edits = [
      { start: source.length, end: source.length, text: tail },
      { start: source.length, end: source.length + tail.length, text: "" },
    ];
    reset = () => {
      document = parser.createDocument(source); index = 0;
    };
    run = () => {
      do_not_optimize(document.edit([edits[index]])); index ^= 1;
    };
  }
  else if (name in attributeSources) {
    const source = attributeSources[name];
    run = () => do_not_optimize(parser.parse(source));
  }
  else {
    const corpus = corpora.find((item) => item.id === corpusIds[name]);
    assert.ok(corpus);
    const engine = { name: "parser", parse: parser.parse };
    run = () => parseCorpus(engine, corpus);
  }

  const events: { startTime: number; duration: number }[] = [];
  const observer = new PerformanceObserver((list) => {
    events.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })));
  });
  observer.observe({ entryTypes: ["gc"] });
  const drain = () => new Promise<void>((done) => setImmediate(done));
  globalThis.gc();
  const warm = performance.now();
  while (performance.now() - warm < 250) {
    run();
  }
  assert.ok(performance.now() - warm <= maxMs);
  reset();
  globalThis.gc();
  await drain();
  // Full GC can clear transient field-type feedback. Re-establish it outside timing.
  const settle = performance.now();
  while (performance.now() - settle < 150) {
    run();
    if (name === "incremental/tail") {
      run(); // Keep the same initial document and edit phase in both variants.
    }
  }
  assert.ok(performance.now() - settle <= maxMs);
  await drain();
  const cpuStart = process.cpuUsage();
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  let count = 0;
  let maxIteration = 0;
  while (budgetMs - (performance.now() - start) > Math.max(1, maxIteration * 1.5)) {
    const iterationStart = performance.now();
    run();
    maxIteration = Math.max(maxIteration, performance.now() - iterationStart);
    count++;
  }
  const end = performance.now();
  const elapsedMs = end - start;
  const cpu = process.cpuUsage(cpuStart);
  const heapAfter = process.memoryUsage().heapUsed;
  assert.ok(elapsedMs <= maxMs && count >= 3);
  await drain();
  await drain();
  observer.disconnect();
  const gc = events.filter((event) => event.startTime >= start && event.startTime < end);
  return { ns: elapsedMs * 1e6 / count, count, elapsedMs, maxIteration, cpu, heapBefore, heapAfter, gcCount: gc.length, gcMs: gc.reduce((sum, event) => sum + event.duration, 0) };
}

if (values.worker) {
  const [bundle, name] = positionals;
  process.stdout.write(JSON.stringify(await observe(bundle, name)));
}
else {
  const [baseline, candidate, output] = positionals;
  assert.ok(baseline && candidate && output, "Expected baseline, candidate, and output paths");
  assert.ok(!existsSync(output), "Preserve existing reports; choose a new output path");
  const blocks = Number(values.blocks);
  assert.ok(blocks === 4 || blocks === 8);
  const variantPath = (value: string) => (value === "remark" ? value : resolve(value));
  const paths = { A: variantPath(baseline), B: variantPath(values.control ? baseline : candidate) };
  if (Object.values(paths).includes("remark")) {
    assert.ok(cases.every((name) => name.startsWith("commonmark/")), "Remark reference requires equivalent CommonMark cases");
  }
  const files = [...new Set([
    ...Object.values(paths).filter((value) => value !== "remark"),
    self,
    resolve("test/benchmark/helpers/abba.ts"),
    resolve("test/benchmark/helpers/utils.ts"),
    resolve("test/benchmark/helpers/corpus.ts"),
    resolve("packages/satorigear/tsdown.config.ts"),
    resolve("pnpm-lock.yaml"),
    ...(values.reference ? [resolve(values.reference)] : []),
    fileURLToPath(import.meta.resolve("mitata")),
    ...(Object.values(paths).includes("remark") ? [fileURLToPath(import.meta.resolve("mdast-util-from-markdown"))] : []),
    ...load().map((corpus) => resolve("test/corpus", corpus.file)),
  ])];
  const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const hashes = files.map(hash);
  const reference = values.reference
    ? JSON.parse(readFileSync(values.reference, "utf8")) as ReferenceReport
    : void 0;
  if (reference) {
    assert.equal(reference.status, "complete");
    assert.ok(reference.paths.B === "remark" || reference.reference?.engine === "mdast-util-from-markdown");
    assert.equal(reference.runtime, process.version);
    assert.equal(reference.cpu, cpus()[0]?.model);
    assert.deepEqual(reference.nodeFlags, process.execArgv);
    assert.equal(reference.nodeOptions, process.env.NODE_OPTIONS ?? null);
    assert.equal(reference.benchmarkVersion, 2);
    assert.equal(reference.budgetMs, budgetMs);
    assert.equal(reference.maxMs, maxMs);
    assert.equal(reference.warmupMs, 250);
    assert.equal(reference.postGcSettleMs, 150);
    assert.equal(reference.inputs[reference.paths.A], hash(paths.A), "Reference estimates require A to be the frozen initial bundle");
    for (const file of [resolve("pnpm-lock.yaml"), resolve("packages/satorigear/tsdown.config.ts"), ...load().map((corpus) => resolve("test/corpus", corpus.file))]) {
      assert.equal(reference.inputs[relative(root, file)] ?? reference.inputs[file], hash(file));
    }
  }
  const meta = {
    runtime: process.version,
    cpu: cpus()[0]?.model,
    arch: arch(),
    platform: platform(),
    osRelease: release(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    nodeFlags: process.execArgv,
    nodeOptions: process.env.NODE_OPTIONS ?? null,
    paths,
    inputs: Object.fromEntries(files.map((file, index) => [file, hashes[index]])),
    blocks,
    control: !!values.control,
    referenceReport: values.reference ? resolve(values.reference) : void 0,
    benchmarkVersion: 2,
    warmupMs: 250,
    postGcSettleMs: 150,
    budgetMs,
    maxMs,
    method: "Alternating ABBA/BAAB; fresh process and module cache per observation; GC before warmup and settling; natural GC included; all samples retained.",
  };
  const results: Record<string, { runs: (Observation & Awaited<ReturnType<typeof observe>>)[]; summary?: ReturnType<typeof analyzeBlocks>; estimatedSpeedupVsRemark?: number }> = {};
  const save = (status: string, error?: string) => writeFileSync(output, JSON.stringify({ ...meta, status, error, results }, null, 2));
  save("incomplete");
  try {
    for (const name of cases) {
      const result = results[name] = { runs: [] } as typeof results[string];
      for (let block = 0; block < blocks; block++) {
        const order = block % 2 ? "BAAB" : "ABBA";
        process.stderr.write(`${name} ${order} ${block + 1}/${blocks}\n`);
        for (const variant of order as Iterable<"A" | "B">) {
          const child = spawnSync(process.execPath, [...process.execArgv, self, "--worker", paths[variant], name], {
            encoding: "utf8",
            maxBuffer: 1024 * 1024,
            timeout: 2500,
          });
          assert.ok(!child.error && child.status === 0, child.error?.message ?? child.stderr);
          const sample = JSON.parse(child.stdout) as Awaited<ReturnType<typeof observe>>;
          assert.ok(sample.elapsedMs > 0 && sample.elapsedMs <= maxMs && sample.count >= 3);
          result.runs.push({ variant, ...sample });
          save("incomplete");
        }
      }
      result.summary = analyzeBlocks(result.runs);
      if (reference?.results[name]) {
        // A point estimate of cumulative progress; the interval above covers this comparison only.
        result.estimatedSpeedupVsRemark = (1 + reference.results[name].summary.changePercent / 100) /
          (1 + result.summary.changePercent / 100);
      }
      save("incomplete");
    }
    assert.deepEqual(files.map(hash), hashes);
    save("complete");
    console.table(Object.entries(results).map(([name, result]) => ({ name, ...result.summary, estimatedSpeedupVsRemark: result.estimatedSpeedupVsRemark })));
  }
  catch (error) {
    save("failed", String(error));
    throw error;
  }
}
