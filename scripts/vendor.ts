import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "vendors/monogram");
const patch = join(root, "patches/monogram.patch");

function git(args: string[], allowFailure = false): boolean {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status === 0) return true;
  if (allowFailure) return false;
  const detail = (result.stderr || result.stdout || "").trim();
  throw new Error(`git ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
}

if (!existsSync(join(vendor, ".git"))) {
  git(["submodule", "update", "--init", "--depth", "1", "--filter=blob:none", "vendors/monogram"]);
}
git(["-C", vendor, "sparse-checkout", "init", "--no-cone"]);
git(["-C", vendor, "sparse-checkout", "set", "--no-cone", "/src/"]);

if (git(["-C", vendor, "apply", "--check", patch], true)) {
  git(["-C", vendor, "apply", patch]);
  console.log("Applied patches/monogram.patch");
}
else if (git(["-C", vendor, "apply", "--reverse", "--check", patch], true)) {
  console.log("patches/monogram.patch is already applied");
}
else {
  throw new Error("monogram patch does not apply cleanly and is not already applied");
}
