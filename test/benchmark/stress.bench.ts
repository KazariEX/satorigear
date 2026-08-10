import { Buffer } from "node:buffer";
import { bench, do_not_optimize, run, summary } from "mitata";
import { createCommonmarkEngines } from "./helpers/engines.ts";
import { fullyRead } from "./helpers/utils.ts";

const source = `${"a**a ".repeat(1_000)}${"a* ".repeat(1_000)}`;
const engines = createCommonmarkEngines();

summary(() => {
  const suffix = `synthetic delimiter stress, ${Buffer.byteLength(source)} bytes`;
  for (const engine of engines) {
    bench(`${engine.name}, fully read (${suffix})`, () => {
      const tree = engine.parse(source);
      do_not_optimize(fullyRead(tree));
      do_not_optimize(tree);
    });
  }
});

await run();
