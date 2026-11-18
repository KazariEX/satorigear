import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "../test/benchmark/helpers/corpus.ts";

// Snapshot preparation and replay only. Rejected prototype generators live in the
// follow-up archive; throughput always runs separately through benchmark-abba.ts.
const [command, directory, variant = "baseline"] = process.argv.slice(2);
assert.ok(directory, "Usage: node scripts/fence-research.mjs prepare|replay|validate|diagnose|profile OUTPUT [VARIANT_OR_TRIAL]");
assert.ok(/^[\w-]+$/.test(variant), "Use a plain variant or archive trial name");
const root = resolve(import.meta.dirname, "..");
const output = resolve(directory);
const fencePath = "packages/satorigear/src/block/fence.ts";
const archivePath = resolve(root, "test/benchmark/reference/fence-followup-node26.json");
const features = { footnote: true, frontmatter: true, math: true, strikethrough: true, table: true, taskList: true, component: true, attributes: true };
const hash = (text) => createHash("sha256").update(text).digest("hex");
const save = (name, value) => writeFileSync(resolve(output, name), JSON.stringify(value, null, 2) + "\n");
const bundle = (name) => resolve(output, name, "index.mjs");
const importVariant = (name) => import(pathToFileURL(bundle(name)).href);

async function buildSnapshot(name, sources) {
  const { build } = await import("tsdown");
  await build({
    config: false,
    cwd: resolve(root, "packages/satorigear"),
    entry: ["src/index.ts"],
    tsconfig: resolve(root, "tsconfig.json"),
    dts: false,
    exports: false,
    sourcemap: true,
    outDir: resolve(output, name),
    outputOptions: { comments: false },
    plugins: [{
      name: "frozen-fence-research",
      load(id) {
        return sources[id.replace(root + "/", "")];
      },
    }],
  });
}

if (command === "prepare" || command === "replay") {
  mkdirSync(output, { recursive: true });
  let sources;
  let selected;
  let trial;
  if (command === "replay") {
    assert.ok(!existsSync(resolve(output, "metadata.json")), "Replay into a fresh directory to retain prior observations");
    const archive = JSON.parse(readFileSync(archivePath, "utf8"));
    trial = archive.trials[variant];
    assert.ok(trial, `Unknown archived trial: ${variant}`);
    selected = Object.fromEntries(Object.entries(trial.sources).map(([name, id]) => {
      const encoded = archive.snapshots[id];
      assert.equal(hash(JSON.stringify(encoded)), id);
      const snapshot = Object.fromEntries(Object.entries(encoded).map(([path, reference]) => {
        const text = archive.texts[reference.$text];
        assert.equal(hash(text), reference.$text);
        return [path, text];
      }));
      return [name, snapshot];
    }));
    sources = selected.baseline;
  }
  else {
    const snapshot = resolve(output, "sources.json");
    sources = existsSync(snapshot) ? JSON.parse(readFileSync(snapshot, "utf8")) : Object.fromEntries(
      execFileSync("rg", ["--files", "packages/satorigear/src"], { cwd: root, encoding: "utf8" }).trim().split("\n")
        .map((path) => [path, readFileSync(resolve(root, path), "utf8")]),
    );
    selected = { baseline: sources };
    if (variant !== "baseline") {
      const candidate = resolve(output, `${variant}-sources.json`);
      assert.ok(existsSync(candidate), "Write a complete candidate source snapshot before preparing a new variant; use replay for archived trials");
      selected[variant] = JSON.parse(readFileSync(candidate, "utf8"));
    }
  }
  save("sources.json", sources);
  const meta = {
    runtime: process.version,
    v8: process.versions.v8,
    cpu: cpus()[0].model,
    arch: process.arch,
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    sourceHashes: Object.fromEntries(Object.entries(sources).map(([path, source]) => [path, hash(source)])),
    variants: {},
  };
  for (const [name, snapshot] of Object.entries(selected)) {
    save(`${name}-sources.json`, snapshot);
    writeFileSync(resolve(output, `${name}-fence.ts`), snapshot[fencePath]);
    await buildSnapshot(name, snapshot);
    const bundleHash = hash(readFileSync(bundle(name)));
    if (trial) {
      assert.equal(bundleHash, trial.metadata.variants[name].bundleHash, `Rebuilt ${name} differs from the archived bundle; inspect runtime and dependencies`);
    }
    meta.variants[name] = { fenceHash: hash(snapshot[fencePath]), bundleHash };
  }
  save("metadata.json", meta);
}
else if (command === "validate") {
  const baseline = await importVariant("baseline");
  const names = process.argv[4] ? [variant] : Object.keys(JSON.parse(readFileSync(resolve(output, "metadata.json"), "utf8")).variants).filter((name) => name !== "baseline");
  assert.ok(names.length && !names.includes("baseline"), "Select at least one candidate to compare against baseline");
  const modules = await Promise.all(names.map(importVariant));
  const results = {};
  for (let index = 0; index < names.length; index++) {
    const actual = modules[index].createParser({ features });
    const expected = baseline.createParser({ features });
    let documents = 0; let edits = 0;
    const check = (source, edit) => {
      assert.deepEqual(actual.parse(source), expected.parse(source), JSON.stringify(source));
      documents++;
      if (!edit) {
        return;
      }
      const a = actual.createDocument(source); const b = expected.createDocument(source);
      for (const change of [edit, { start: edit.start, end: edit.start + edit.text.length, text: source.slice(edit.start, edit.end) }]) {
        a.edit([change]); b.edit([change]);
        assert.deepEqual(a.tree, b.tree);
        assert.deepEqual(a.tree, actual.parse(a.source));
        edits++;
      }
    };
    for (const corpus of load()) {
      for (const original of corpus.documents) {
        for (const ending of ["\n", "\r", "\r\n", "mixed"]) {
          let row = 0;
          check(original.replace(/\r\n|\r|\n/g, () => (ending === "mixed" ? ["\n", "\r", "\r\n"][row++ % 3] : ending)));
        }
      }
    }
    for (const marker of ["`", "~", "$"]) {
      for (const length of [2, 3, 4, 8, 32, 257]) {
        for (const prefix of ["", " ", "   ", "    ", "\t", "> ", "- ", "> - "]) {
          for (const tail of ["", " ", "\t", "x", "\u2028", "\u2029", "\0", " " + marker]) {
            for (const delta of [-1, 0, 1]) {
              const open = marker.repeat(length); const close = marker.repeat(length + delta);
              const ending = ["\n", "\r", "\r\n"][delta + 1];
              const source = [prefix + open, prefix + "body 中😀", prefix + close + tail, prefix + "after", ""].join(ending);
              const position = source.indexOf(close + tail, source.indexOf("body"));
              check(source, { start: position, end: position + 1, text: "x" });
            }
          }
        }
      }
    }
    // A required-position probe alone cannot prove the intervening run.
    for (const marker of ["`", "~", "$"]) {
      for (const body of [marker + " " + marker, marker + "x" + marker, marker + "\t" + marker, marker.repeat(2) + " " + marker]) {
        check(`${marker.repeat(3)}\n${body}\nafter\n${marker.repeat(3)}\n`);
      }
    }
    // Force the large-input byte path. Low-byte aliases must remain literal UTF-16.
    for (const marker of ["`", "~", "$"]) {
      for (const high of [0x100, 0x1000, 0xD800]) {
        for (const ending of ["\n", "\r", "\r\n"]) {
          const alias = String.fromCharCode(high + marker.charCodeAt(0));
          const spaceAlias = String.fromCharCode(high + 32);
          for (const prefix of ["", "> "]) {
            const lines = [marker.repeat(3), "a".repeat(2200), alias + marker.repeat(2), spaceAlias + marker.repeat(3), "alias Ċ č 上 不", "after", marker.repeat(3), "tail"];
            const source = lines.map((line) => prefix + line).join(ending);
            check(source, { start: source.indexOf(alias), end: source.indexOf(alias) + 1, text: marker });
          }
        }
      }
    }
    // Exercise repeated info matching, including whitespace introduced by decoding.
    const infoBlocks = [];
    for (const marker of ["```", "~~~"]) {
      for (const info of ["", " js", " js meta", " js\t  meta", " a\\ b", " a&amp;b meta", " &#32; x", " &Tab; x"]) {
        const source = `${marker}${info}\nbody\n${marker}\n`;
        check(source, { start: marker.length, end: marker.length + info.length, text: " replacement\tmeta" });
        infoBlocks.push(source);
      }
    }
    const combinedInfo = infoBlocks.join("\n");
    check(combinedInfo, { start: combinedInfo.indexOf("body"), end: combinedInfo.indexOf("body") + 4, text: "changed" });
    // Components borrow physical subranges; physical continuity does not imply a root block.
    for (const marker of ["```", "~".repeat(32), "$$"]) {
      const literal = `${marker}\nbody\n${marker}\n`;
      const component = `::card\n${literal}::\n`;
      for (const wrapped of [
        component,
        `::card\n#content\n${literal}#footer\nafter\n::\n`,
        `::outer\n:::child\n${literal}:::\n::\n`,
        component.trimEnd().split("\n").map((row) => "> " + row).join("\n") + "\n",
        "- " + component.trimEnd().split("\n").join("\n  ") + "\n",
        literal + "\n" + component + "\n" + literal,
      ]) {
        for (const ending of ["\n", "\r", "\r\n"]) {
          const source = wrapped.replaceAll("\n", ending);
          const at = source.indexOf("body");
          check(source, { start: at, end: at + 4, text: "changed 中" });
        }
      }
    }
    // Equal-length edits can preserve literal text while changing source row geometry.
    for (const [before, after] of [
      ["```\r\nx\r\n```", "```\nx\n  ```"],
      ["```\n```  ", "```\n\n``` "],
      ["before\n\n```\r\nx\r\n```\n\nafter", "before\n\n```\nx\n  ```\n\nafter"],
    ]) {
      assert.equal(before.length, after.length);
      check(before, { start: 0, end: before.length, text: after });
    }
    for (const source of ["```js\nbody\n```\n", "$$\nbody\n$$\n", "> ```\n> body\n> ```\n"]) {
      check(source);
      const first = actual.parse(source);
      const second = actual.parse(source);
      const block = first.children[0];
      const literal = block.children?.[0] ?? block;
      literal.value = "mutated";
      literal.position.start.offset = -1;
      assert.deepEqual(second, expected.parse(source), "Literal nodes and positions must belong to one parse");
    }
    results[names[index]] = { documents, edits, completeAstAndPositions: true, independentLiteralNodes: true };
  }
  const csp = process.execArgv.includes("--disallow-code-generation-from-strings") ? "-csp" : "";
  save(`validation${csp}${process.argv[4] ? "-" + variant : ""}.json`, results);
  console.log(results);
}
else if (command === "diagnose") {
  const { createParser } = await importVariant(variant);
  const parser = createParser();
  const source = load()[0].documents[0];
  console.log("FENCE_PHASE warmup");
  for (let i = 0; i < 1600; i++) {
    parser.parse(source);
  }
  globalThis.gc?.();
  console.log("FENCE_PHASE settling");
  for (let i = 0; i < 800; i++) {
    parser.parse(source);
  }
  console.log("FENCE_PHASE diagnostic");
  for (let i = 0; i < 800; i++) {
    parser.parse(source);
  }
  console.log("FENCE_PHASE done");
}
else if (command === "profile") {
  const { Session } = await import("node:inspector/promises");
  const { SourceMap } = await import("node:module");
  const iterations = Number(process.env.FENCE_PROFILE_ITERATIONS ?? 12000);
  const interval = Number(process.env.FENCE_SAMPLE_INTERVAL_US ?? 211);
  assert.ok(Number.isSafeInteger(iterations) && iterations > 0);
  assert.ok(Number.isSafeInteger(interval) && interval > 0);
  const { createParser } = await importVariant(variant);
  const parser = createParser();
  const source = load()[0].documents[0];
  const sourcesPath = existsSync(resolve(output, `${variant}-sources.json`)) ? `${variant}-sources.json` : "sources.json";
  const sources = JSON.parse(readFileSync(resolve(output, sourcesPath), "utf8"));
  const physicalPrecompute = /physicalFenceHeader|fenceCandidate\(|possibleFence\(|sourceBytes\(|sourceUnits\(|"utf16le"/.test(sources["packages/satorigear/src/block/lines.ts"]);
  const code = sources["packages/satorigear/src/profile/features/code.ts"];
  const scanner = sources["packages/satorigear/src/block/scanner.ts"];
  const directRootAccounting = process.env.FENCE_PROFILE_DIRECT_ROOT === "1" || /directBlocks/.test(scanner);
  const directCallback = scanner.indexOf("context.scanBlockLines(source, lines, tokens, (_start, _end, tokenStart)");
  const directCallbackLine = directCallback < 0 ? -1 : scanner.slice(0, directCallback).split("\n").length - 1;
  const lineAt = (needle) => {
    const at = code.indexOf(needle);
    assert.ok(at >= 0);
    return code.slice(0, at).split("\n").length - 1;
  };
  const handlerLines = [lineAt("export function codeFenceAt("), lineAt("interrupt(source, lines, index, contentOffset)"), lineAt("start(source, lines, tokens, start, contentOffset")];
  const builderLine = lineAt("build(tokenStart, context)");
  for (let i = 0; i < 1600; i++) {
    parser.parse(source);
  }
  globalThis.gc?.();
  for (let i = 0; i < 800; i++) {
    parser.parse(source);
  }
  const session = new Session();
  session.connect();
  await session.post("Profiler.enable");
  await session.post("Profiler.setSamplingInterval", { interval });
  await session.post("Profiler.start");
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    parser.parse(source);
  }
  const elapsedMs = performance.now() - start;
  const { profile } = await session.post("Profiler.stop");
  session.disconnect();
  const map = new SourceMap(JSON.parse(readFileSync(bundle(variant) + ".map", "utf8")));
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map(profile.nodes.flatMap((node) => (node.children ?? []).map((child) => [child, node.id])));
  for (const node of nodes.values()) {
    const frame = node.callFrame;
    if (frame.url !== bundle(variant) && frame.url !== pathToFileURL(bundle(variant)).href) {
      continue;
    }
    const entry = map.findEntry(frame.lineNumber, frame.columnNumber);
    if (!("originalSource" in entry)) {
      continue;
    }
    frame.url = new URL(entry.originalSource, pathToFileURL(bundle(variant) + ".map")).href;
    frame.lineNumber = entry.originalLine;
    frame.columnNumber = entry.originalColumn;
  }
  const weight = { module: 0, recognition: 0, withSharedCodeBuilder: 0, withRelocatedFenceWork: 0 };
  const self = new Map();
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    let id = profile.samples[i];
    const delta = profile.timeDeltas[i];
    total += delta;
    self.set(id, (self.get(id) ?? 0) + delta);
    const leaf = nodes.get(id)?.callFrame;
    const relocatedSelf = directRootAccounting && leaf && (
      leaf.url.endsWith("/document.ts") && leaf.functionName === "parse"
      || leaf.url.endsWith("/block/lines.ts") && leaf.functionName === "advanceToLine"
      || leaf.url.endsWith("/block/scanner.ts") && (leaf.functionName === "scan" || leaf.lineNumber === directCallbackLine)
    );
    let relocated = !!relocatedSelf;
    let module = false; let recognition = false; let builder = false;
    while (nodes.has(id)) {
      const frame = nodes.get(id).callFrame;
      relocated ||= directRootAccounting && (
        frame.url.endsWith("/block/scanner.ts") && ["appendDirectTokens", "emitDirectBlock"].includes(frame.functionName)
        || frame.url.endsWith("/block/lines.ts") && frame.functionName === "advanceToLine"
      );
      module ||= frame.url.endsWith("/block/fence.ts") || frame.url.endsWith("/block/lines.ts") && (
        frame.functionName === "physicalFenceHeader" || physicalPrecompute && frame.functionName === "scan"
      );
      if (frame.url.endsWith("/profile/features/code.ts")) {
        recognition ||= handlerLines.includes(frame.lineNumber);
        builder ||= frame.lineNumber === builderLine;
      }
      id = parents.get(id);
    }
    if (module) {
      weight.module += delta;
    }
    if (module || recognition) {
      weight.recognition += delta;
    }
    if (module || recognition || builder) {
      weight.withSharedCodeBuilder += delta;
    }
    if (module || recognition || builder || relocated) {
      weight.withRelocatedFenceWork += delta;
    }
  }
  const deltas = [...profile.timeDeltas].sort((a, b) => a - b);
  const summary = { diagnosticOnly: true, variant, iterations, requestedIntervalUs: interval, elapsedMs, usPerParse: elapsedMs * 1000 / iterations, sampledUs: total, samples: profile.samples.length, medianIntervalUs: deltas[deltas.length >>> 1], bundleHash: hash(readFileSync(bundle(variant))), scope: { handlerLines, builderLine, physicalPrecompute, directRootAccounting, directCallbackLine, note: "Stack union; shared code builder includes indented code. Cached-line variants conservatively include the entire physical scan. Relocated-work scope additionally charges all root materializer and BlockScanner.scan self time, direct-block callback self time, and descendants of appendDirectTokens, emitDirectBlock and advanceToLine; ordinary non-fence builder descendants are excluded. Use FENCE_PROFILE_DIRECT_ROOT=1 for the paired baseline. GC remains in denominator. Native/inlined attribution can be incomplete." }, fence: Object.fromEntries(Object.entries(weight).map(([key, us]) => [key, { percent: us / total * 100, sampledUsPerParse: us / iterations }])), top: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([id, us]) => ({ ...nodes.get(id).callFrame, percent: us / total * 100, sampledUsPerParse: us / iterations })) };
  const name = `profile-${variant}-${interval}-${iterations}`;
  assert.ok(!existsSync(resolve(output, name + ".json")), "Keep prior observations; use a fresh profile parameter combination or directory");
  save(name + ".json", summary);
  save(name + ".cpuprofile", profile);
  console.log(summary);
}
else {
  throw new Error(`Unknown command: ${command}`);
}
