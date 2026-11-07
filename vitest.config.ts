import codspeed from "@codspeed/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    codspeed(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    benchmark: {
      include: [
        "test/benchmark/codspeed/**/*.bench.ts",
      ],
    },
    server: {
      deps: {
        // Load the built package natively so benchmarks avoid module runner overhead.
        external: [
          /packages\/satorigear\/dist\//,
        ],
      },
    },
  },
});
