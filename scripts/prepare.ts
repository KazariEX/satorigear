import { link } from "node:fs/promises";
import { basename, dirname, resolve as nodeResolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resolve = (...paths: string[]) => nodeResolve(__dirname, ...paths);

const destinations = [
    ["../README.md", "../packages/satorigear"]
];

for (const [src, dest] of destinations) {
    await link(resolve(src), resolve(dest, basename(src)));
}