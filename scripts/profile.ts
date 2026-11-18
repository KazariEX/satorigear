import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { HeapProfiler, Runtime } from "node:inspector";
import { Session } from "node:inspector/promises";
import { SourceMap } from "node:module";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { do_not_optimize } from "mitata";
import { build } from "tsdown";

// Profiling is diagnostic; use benchmark-abba.ts separately for throughput.
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    bundle: { type: "string" },
    heap: { type: "boolean" },
    iterations: { type: "string", default: "12000" },
  },
});
assert.equal(positionals.length, 1, "Usage: node --expose-gc scripts/profile.ts OUTPUT [--bundle FILE] [--heap] [--iterations N]");
assert.ok(globalThis.gc, "Run with --expose-gc");
const output = resolve(positionals[0]);
assert.ok(!existsSync(output), "Use a fresh output directory to retain earlier measurements");
const iterations = Number(values.iterations);
assert.ok(Number.isSafeInteger(iterations) && iterations > 0);
mkdirSync(output, { recursive: true });
const root = resolve(import.meta.dirname, "..");
const bundle = values.bundle ? resolve(values.bundle) : resolve(output, "bundle/index.mjs");
if (!values.bundle) {
  await build({
    config: false,
    cwd: resolve(root, "packages/satorigear"),
    entry: ["src/index.ts"],
    tsconfig: resolve(root, "tsconfig.json"),
    dts: false,
    exports: false,
    sourcemap: true,
    outDir: resolve(output, "bundle"),
    outputOptions: { comments: false },
  });
}
const mapPath = bundle + ".map";
const payload = JSON.parse(readFileSync(mapPath, "utf8"));
const sourceMap = new SourceMap(payload);
const { createParser } = await import(pathToFileURL(bundle).href);
const parser = createParser();
const sourcePath = resolve(root, "test/corpus/commonmark-spec.md");
const source = readFileSync(sourcePath, "utf8");
function work(count: number): void {
  for (let index = 0; index < count; index++) {
    do_not_optimize(parser.parse(source));
  }
}
function mapFrame(frame: Runtime.CallFrame): void {
  if (frame.url !== pathToFileURL(bundle).href && frame.url !== bundle) {
    return;
  }
  const entry = sourceMap.findEntry(frame.lineNumber, frame.columnNumber);
  if (!("originalSource" in entry)) {
    return;
  }
  frame.url = new URL(entry.originalSource, pathToFileURL(mapPath)).href;
  frame.lineNumber = entry.originalLine;
  frame.columnNumber = entry.originalColumn;
  if (entry.originalSource.endsWith("/block/lines.ts") && frame.functionName === "scan") {
    const index = payload.sources.indexOf(entry.originalSource);
    const prefix = payload.sourcesContent[index].split("\n").slice(0, entry.originalLine + 1).join("\n");
    frame.functionName = [...prefix.matchAll(/(?:export )?class (\w+)/g)].at(-1)?.[1] + ".scan";
  }
}
function write(name: string, value: unknown): void {
  writeFileSync(resolve(output, name), JSON.stringify(value));
}
work(1600);
globalThis.gc();
work(800);
const session = new Session();
session.connect();
if (values.heap) {
  await session.post("HeapProfiler.enable");
  await session.post("HeapProfiler.startSampling", {
    samplingInterval: 32768,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  work(iterations);
  const { profile } = await session.post("HeapProfiler.stopSampling");
  write("allocations.heapprofile", profile);
  const mapped = structuredClone(profile);
  function visit(node: HeapProfiler.SamplingHeapProfileNode): void {
    mapFrame(node.callFrame);
    node.children.forEach(visit);
  }
  visit(mapped.head);
  assert.deepEqual("samples" in mapped ? mapped.samples : void 0, "samples" in profile ? profile.samples : void 0);
  write("allocations.source.heapprofile", mapped);
}
else {
  await session.post("Profiler.enable");
  await session.post("Profiler.setSamplingInterval", { interval: 250 });
  await session.post("Profiler.start");
  work(iterations);
  const { profile } = await session.post("Profiler.stop");
  write("cpu.cpuprofile", profile);
  const mapped = structuredClone(profile);
  for (const node of mapped.nodes) {
    mapFrame(node.callFrame);
    delete node.positionTicks;
  }
  assert.deepEqual(mapped.samples, profile.samples);
  assert.deepEqual(mapped.timeDeltas, profile.timeDeltas);
  write("cpu.source.cpuprofile", mapped);
}
session.disconnect();
const hash = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
write("metadata.json", {
  diagnosticOnly: true,
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  runtime: process.version,
  v8: process.versions.v8,
  cpu: cpus()[0].model,
  mode: values.heap ? "allocations" : "cpu",
  iterations,
  warmup: 1600,
  postGcSettling: 800,
  sourceUnits: source.length,
  sourceBytes: new TextEncoder().encode(source).length,
  hashes: Object.fromEntries([bundle, mapPath, sourcePath, resolve(root, "scripts/profile.ts")].map((path) => [path, hash(path)])),
  sourceView: "Only frame locations/names changed; generated position ticks omitted; sampling data retained.",
});
console.log(output);
