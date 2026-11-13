# Controlled comparisons and runtime diagnostics

Build and freeze both bundles before comparing them. Run without concurrent builds, tests or profiles:

```sh
taskpolicy -c utility pnpm benchmark:abba baseline.mjs candidate.mjs comparison.json --cases commonmark/spec --blocks 8
```

Each observation uses a fresh process and module cache, 250 ms warmup, full GC, one 150 ms settling round and approximately 300 ms measurement. Warmup, each settling round and measurement are capped at 500 ms. Natural GC remains inside timing. Four or eight alternating ABBA/BAAB blocks retain every observation, including partial reports on failure.

Use the same workload with V8 tracing to investigate compilation, dependent-code invalidation and bailouts:

```sh
taskpolicy -c utility pnpm benchmark:abba baseline.mjs candidate.mjs jit.json --jit --cases document/spec
```

`--jit` saves hashed worker logs in `jit.json.jit/` and classifies events by loading, warmup, full GC, settling and measurement. Reports are marked `diagnosticOnly`; they do not calculate throughput deltas or remark estimates and cannot serve as performance references. Compilation starts, completions, optimization completions, invalidations and bailouts are distinct events, not a count of unique functions.

Full GC can invalidate optimized code. The absence of bailouts does not establish JIT quiescence. To investigate sensitivity to post-GC recovery, declare more bounded rounds with `--settle-rounds N` (1–16, each 150 ms). Incremental settling always executes complete append/remove pairs. More rounds do not automatically prove steady state. Choose the comparison protocol before collecting admission samples, and retain contrary results.

Reference estimates require matching settling settings; older reports without a round count mean one round. `--control` uses the baseline bundle in both slots. `document/spec` measures document creation, while `commonmark/spec` measures one-shot parsing.

Archived measurements and recent findings are organized in the [report index](reference/README.md). Historical status and ratios apply only to their frozen source and protocol.
