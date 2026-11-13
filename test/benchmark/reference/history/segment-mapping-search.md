# Segment mapping search: locality without a monotonicity assumption

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

No source candidate is retained. Production source and bundle are restored to `20f4f59`; the bundle remains **160,983 B**, SHA-256 `5eb3f02a5b9c6527c861e6d0e63655cf9419206dac4d64db1827c1b50dece911`. The experiment started at records commit `4e9fd6a`. It establishes useful locality and substantial specialized gains, but also resolved regressions. It does not establish a new spec improvement or remark ratio. The 100× goal remains unmet.

## Scope and prior evidence

Only `packages/satorigear/src/source-view.ts` was changed. Text projection, block/inline tokens, grammar APIs, position objects, incremental region ownership and codegen/CSP remain unchanged.

Earlier JIT-phase research had counted segmented queries but deferred an implementation: starts and ends are not monotonically requested. For example, the builder can map a leaf end before finishing preceding literal text. This experiment therefore did not repeat the rejected assumption that a cursor can only move forward. It tested a bidirectional cursor, then bounded binary search seeded from the previous result, then a stateless proportional seed.

The initial diagnostic executes the original binary search and independently checks a simulated bidirectional cursor against every result. Generated and CSP full AST/positions agree. Spec has 882 segmented queries, 2,424 binary iterations, and only 253 simulated cursor moves. Dense quotation has 15,200 queries, 162,963 binary iterations and 1,599 moves. But one code span across 1,602 projected segments needs only six queries: binary takes 66 iterations, while the cursor travels 4,803 segments, including a 1,601-segment backward jump. Locality alone does not justify linear search.

## Variants and admission

| Variant | Model | Bundle | Decision |
| --- | --- | ---: | --- |
| A | Original pure binary lookup | 160,983 B | Restored |
| B | View-owned segment index; linear movement in either direction | 160,982 B | Long-span regression |
| C | Cached first probe, then bisection; shared end mapping; private lookup helper | 161,048 B | Correctness checked; not timed because bundle grew |
| D | C with its single-caller lookup moved into `mapOffset` | 160,961 B | Fresh-document regression remains unresolved |
| E | D without cache state; first probe estimated from offset / view length | 160,931 B | Spec/document and skewed-width regressions |

B resets its cursor whenever the view is rebuilt. Shifting a retained view changes source bases, not projected segment boundaries. D retains these lifetimes but checks the cached interval first; if it misses, that comparison narrows the search, and subsequent probes bisect. Its worst-case query remains logarithmic after the first probe. E removes the field and writes entirely, using `Math.floor(offset * segmentCount / text.length)` for only the first probe, then the same bisection. Unequal segment lengths do not affect correctness but can make this guess costly.

C/D/E share exclusive-end mapping through the preceding character: a positive end maps `end - 1`, then adds one; zero maps zero. Inline chunks that enter segmented views have positive lengths. Left/right gap bias, EOF and empty contiguous views were covered by public syntax/position checks. No new feature-facing API or parser mode was added.

## Unprofiled ABBA/BAAB results

Node **26.13.0**, Apple **M1 Pro**, all commands under `taskpolicy -c utility`. Each observation starts a fresh process/module, performs full GC, 250ms warmup, another full GC and 150ms settling, then measures approximately 300ms with natural GC included. All 336 observations are retained; longest measurement **299.443ms**. Each row below has four alternating ABBA/BAAB blocks and a paired-log-ratio Student-t 95% interval. Positive means slower. Cross-zero intervals do not establish equivalence.

| Comparison / workload | Change | 95% CI |
| --- | ---: | --- |
| A → B, spec | −0.16% | [−2.03%, +1.75%] |
| A → B, examples | −0.14% | [−1.56%, +1.30%] |
| A → B, dense quotation | **−38.98%** | [−39.47%, −38.48%] |
| A → B, long code span | **+2.47%** | [+0.99%, +3.96%] |
| A → D, spec | −0.09% | [−0.48%, +0.31%] |
| A → D, examples | +0.13% | [−3.13%, +3.49%] |
| A → D, Rust | −0.30% | [−1.12%, +0.53%] |
| A → D, APIs | +0.87% | [−1.51%, +3.30%] |
| A → D, createDocument/spec | **+1.26%** | [+0.36%, +2.17%] |
| A → D, tail edit | +1.13% | [−1.16%, +3.47%] |
| A → D, reference availability edit | +1.55% | [−2.73%, +6.02%] |
| A → D, dense quotation | **−32.44%** | [−34.89%, −29.91%] |
| A → D, long code span | +0.59% | [−1.21%, +2.42%] |
| A → D, nested inline quotation | **−23.67%** | [−24.32%, −23.02%] |
| A → layout-only control, createDocument/spec | +0.19% | [−1.79%, +2.21%] |
| A → E, spec | **+1.26%** | [+0.35%, +2.18%] |
| A → E, createDocument/spec | **+1.79%** | [+0.49%, +3.10%] |
| A → E, dense quotation | **−27.01%** | [−27.90%, −26.11%] |
| A → E, long code span | +0.12% | [−1.39%, +1.66%] |
| A → E, wide first segment | **+72.24%** | [+71.14%, +73.35%] |
| A → E, wide last segment | **+26.26%** | [+24.24%, +28.33%] |

The wide-segment guards put 1,000 code spans in one long quoted line and 1,000 short quoted lines before or after it. They are ordinary public syntax, not private implementation tests. D's operation counts were also checked on these guards, but its throughput on them was not measured. A prepared segmented-reference-edit harness was not executed; it supplies no admission evidence.

## Runtime attribution and adjustments

Each CPU group uses four alternating blocks of fresh processes, 100μs requested sampling, the same bounded warmup/GC/settling schedule and at most 500ms measurement. Profiles are clipped to measured monotonic-clock boundaries, with ±100μs boundary sensitivity and profiler-clock audit. Profiled elapsed times are diagnostics, not replacements for unprofiled admission.

The document profile calls `createDocument` directly; the unprofiled harness also passes its result to `do_not_optimize`. This difference further limits using the document profile as an isolated explanation of its throughput regression. The parse guards use the same `parseCorpus` consumer as their unprofiled counterparts.

| Diagnostic group | Mean elapsed, μs/op | Observed GC, μs/op | Mapping self samples, μs/op |
| --- | --- | --- | --- |
| B, long code span | 130.97 → 135.39 | 2.00 → 2.02 | binary helper 0.25 → cursor helper 4.95 |
| B, dense quotation | 1,529.61 → 864.35 | 101.26 → 66.64 | binary helper 460.37 → cursor helper 26.51 |
| D, createDocument/spec | 1,016.41 → 1,022.41 | 11.67 → 11.59 | helper + mapOffset + mapEnd 12.51 → 13.66 |
| E, wide first segment | 232.16 → 398.55 | 4.24 → 4.26 | helper + mapOffset + mapEnd 32.81 → 169.44 |

B's long-span movement and CPU cost motivated the actual B → D algorithm adjustment; the adverse observation was not discarded. D removes linear traversal and retains strong local gains, but its document result remains inadmissible. Sampling does not uniquely identify the cause of that smaller regression: aggregate mapping self samples account for only part of the elapsed difference and inlining changes attribution.

V8 `%DebugPrint` after constructor slack tracking finishes shows A objects at **48B / three in-object properties**, D at **56B / four**, and E back at **48B / three**. Both contiguous and segmented instances share the corresponding layout. The layout-only control injects just the extra private field and reset write into frozen A; removing those two additions reconstructs A exactly. Its broad interval does **not** prove D's document regression is caused by the larger object. This is why E's lack of cache state is not described as a demonstrated fix.

The counter probes distinguish loop iterations from bound comparisons. E's wide-first guard performs 37,858 search iterations plus 33,859 lower-bound comparisons, versus A's 40,000 single-bound iterations. This supports the cost of repeatedly guessing outside the very wide segment. For wide-last, E performs 33,937 iterations plus 4,001 lower-bound comparisons versus A's 40,020 iterations, yet is slower; comparison count alone cannot explain that result. No exact native-instruction or division-cost attribution is claimed.

Phase-tagged V8 logs include optimization completions during measurement. B's dense workload additionally shows allocation-site-tenuring invalidations and bailouts in both variants; it is not JIT-quiescent. B long-span, D document and E wide-first logs have no measured bailout/invalidation. D's `measure` marker was embedded in a compiler-output line, so the diagnostic summarizer was corrected to find phase markers within lines. The original summary is retained; its missing D measurement phase must not be read as proof of no events. Unprofiled timing is unaffected.

## Validation, restoration and reuse limits

B/C/D each pass generated and CSP differential checks of 2,614 corpus AST/position cases, plus 848 mapping/document checks covering 752 edits per backend. E expands the mapping cases to 1,064 checks / 944 edits per backend, adds both skewed-width cases and Unicode input, and passes 4,608 feature edits per backend. The mapping checks include mixed LF/CRLF/CR, hard breaks, nested syntax, components/attributes, preceding inserts and removals, definition-triggered re-resolution and full replacement.

E also passes all **198 existing tests**, typecheck, build and changed-file lint. Those repository tests were not rerun separately for B/C/D. All tests added for this experiment are cache-local public parser checks, not repository tests for private parser details. The first D instrumentation attempt used a nonexistent generated section marker and failed before parsing; its script and both logs are preserved. Corrected counters compare actual lookup results and complete ASTs in both backends.

The final rebuild exactly matches frozen A. No experimental source commit, revert commit, worktree, push or account switch is introduced. Data and this explanation are folded into the single trailing records commit.

`segment-finger-4e9fd6a-node26-m1pro.json` contains the frozen bundles, source patches, scripts, all measurements, CPU profiles, phase logs, layout dumps, validation and setup failures. `candidate.mjs` is a validation alias left at E inside the ignored cache; production `dist/index.mjs` is restored A. Use the canonical `candidate-B/C/D/E.mjs` files when reproducing a variant. All normal measurements can be reproduced with the archived harness, matching report case lists and a fresh output filename, under `taskpolicy -c utility` and the recorded Node version.

Do not retry the unchanged linear finger, cached-search D, or proportional seed E as if untested. A useful next premise would remove repeated mapping requests or establish a concrete different call path that addresses D's document cost. Reusing an integer under two unrelated meanings, adding feature-owned cursor state, or adding special handling for these guard shapes would make the model less clear and was not implemented.
