import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "vendors/monogram");
const patches = [
  join(root, "patches/0.external-token-parser.patch"),
  join(root, "patches/2.delimited-span-lexing.patch"),
  join(root, "patches/3.hard-break-lexing.patch"),
  join(root, "patches/4.parser-arena-allocation.patch"),
  join(root, "patches/9.emitted-newline-lexer.patch"),
  join(root, "patches/11.emitted-lexer-state-pruning.patch"),
  join(root, "patches/12.packed-token-lexer.patch"),
];

function git(args: string[], allowFailure = false, index?: string): boolean {
  const env = index ? { ...process.env, GIT_INDEX_FILE: index } : process.env;
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env });
  if (result.status === 0) {
    return true;
  }
  if (allowFailure) {
    return false;
  }
  const detail = (result.stderr || result.stdout || "").trim();
  throw new Error(`git ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
}

function patchedPaths(): string[] {
  const paths = new Set<string>();
  for (const patch of patches) {
    for (const match of readFileSync(patch, "utf8").matchAll(/^diff --git a\/(\S+) b\/\S+$/gm)) {
      paths.add(match[1]);
    }
  }
  return [...paths];
}

function matchesPatchedState(paths: string[]): boolean {
  const directory = mkdtempSync(join(tmpdir(), "satorigear-vendor-"));
  const index = join(directory, "index");
  try {
    git(["-C", vendor, "read-tree", "HEAD"], false, index);
    for (const patch of patches) {
      git(["-C", vendor, "apply", "--cached", patch], false, index);
    }
    return git(["-C", vendor, "diff", "--quiet", "--", ...paths], true, index);
  }
  finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (!existsSync(join(vendor, ".git"))) {
  git(["submodule", "update", "--init", "--depth", "1", "--filter=blob:none", "vendors/monogram"]);
}
git(["-C", vendor, "sparse-checkout", "init", "--no-cone"]);
git(["-C", vendor, "sparse-checkout", "set", "--no-cone", "/src/"]);

const paths = patchedPaths();
if (matchesPatchedState(paths)) {
  console.log("monogram patch series is already applied");
}
else if (git(["-C", vendor, "diff", "--quiet", "HEAD", "--", ...paths], true)) {
  for (const patch of patches) {
    git(["-C", vendor, "apply", patch]);
  }
  console.log("Applied monogram patch series");
}
else {
  throw new Error("monogram vendor is neither clean nor at the expected patched state");
}
