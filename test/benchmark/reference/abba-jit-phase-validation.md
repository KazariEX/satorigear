# ABBA runtime phase diagnostics

> 工具诊断的历史验证记录；不作为当前解析器的吞吐结论。

Committed implementation: `09d6015 test: report JIT events by benchmark phase`.

The previous investigation found that explicit full GC could invalidate optimized code and that compilation continued into measurement. Counting only bailout lines missed this distinction. The ABBA tool now records compilation starts/completions, optimization completions, dependent-code invalidations and bailouts by phase with `--jit`. Raw worker logs are retained and hashed. Diagnostic reports cannot generate throughput deltas or remark estimates, or be used as performance references.

`--settle-rounds N` declares 1–16 post-GC rounds of 150 ms. Every round remains bounded by 500 ms; incremental settling completes append/remove pairs. Reports record each round's count/duration, and reference validation rejects different settings. The default remains one round. More rounds are a sensitivity control, not an automatic stable-tier guarantee. `document/spec` now exposes the document-creation workload used in the investigation. See [usage](../README.md).

| Validation | Evidence |
| --- | --- |
| Ordinary A/A control | 16 fresh-process observations, four alternating ABBA/BAAB blocks; interval includes zero |
| Document JIT diagnostic | 16 observations with retained phase logs; 48 post-GC invalidations and 115 measured optimization completions |
| Final tool, two-round incremental diagnostic | 16 observations; exact round propagation and even edit counts; 206 measured optimization completions |
| Final ordinary worker | Valid JSON observation with one default settling round |
| Invalid CLI/reference combinations | Zero/fractional/excessive rounds, JIT-plus-reference, diagnostic references and mismatched reference rounds rejected before workers |
| Static checks | Typecheck, lint and whitespace checks pass |

All commands use `taskpolicy -c utility`. No own tests/builds/profiles overlapped throughput. The longest measurement among the three full runs was 299.038 ms. The A/A point estimate of −2.66% (CI −5.41% to +0.17%) is **not** a speedup; identical bundles and an interval containing zero illustrate the need to retain uncertainty. JIT event counts are not unique-function counts.

Two possible parser directions were screened before implementation. Physical location projection already follows source order. Segmented `SourceView` mapping makes 882 searches / 2,424 binary-search steps on spec, while the dense quote stress case is much larger. Its view-coordinate calls are not strictly monotonic, so the physical locator's invariant cannot simply be transferred. Separately, 82 spec emissions only prune raw candidates, copying 65 semantic records; passing those raw candidates into AST projection would shift work and alter the stream contract. Neither direction was benchmarked or claimed as a proven rejection or gain.

The parser package and dist are unchanged. The four incoming pending source files remain unstaged on `main`, including the unadmitted shortcut-identifier candidate. There is no new parser speedup or remark ratio. The 100× goal remains active and unmet.

The JSON archive preserves all observations, exact executed tool revisions, raw logs, structural work-count probes, CLI checks and hashes. Readable diagnostic summaries contain event counts; their complete event lists remain in the compressed raw-report artifacts. These diagnostics improve attribution; they do not yet explain the exact cause of the pending candidate's small regression or establish a universally quiescent measurement protocol.
