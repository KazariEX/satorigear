# Native callback batching for physical line discovery

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Neither candidate is retained. Production source and the **161,093 B** bundle are restored byte-for-byte to `2c1b10c` / SHA-256 `647a800e21901ec1455291689ca40e330115d43ddb15946efffc118d2e759f64`. Records base is `05fdacf`. The previous direct reference remains **80.032× remark** for this exact bundle; remark is not rerun here. The 100× objective remains active and unmet.

## Hypothesis and isolated changes

Earlier current-row prototypes had already removed their compatibility adapters and still regressed. They were not retried. Existing split, regex-test and sticky-line experiments also remained closed. This experiment tests a different execution mechanism: one native global replacement call invokes row-writing callbacks instead of a JavaScript loop repeatedly invoking LF/CR literal searches. It preserves the same four-field table, range consumers, generic rescan semantics, borrowed views, locator and incremental ownership. No feature API, token protocol or codegen change is introduced.

Only `packages/satorigear/src/block/lines.ts` changes:

| Variant | Native matching and callback | Source delta | Bundle |
| --- | --- | ---: | ---: |
| A | Existing exhausted LF/CR `indexOf` streams | — | 161,093 B |
| B | Match endings with `/\r\n?|\n/g`; callback appends a row and returns its ending; final unterminated row appended separately | +10 / −22 | 160,780 B |
| C | Match complete lines with `/[^\r\n]*(?:\r\n?|\n|$)/g`; callback derives the ending and returns an empty string; ignore terminal zero-length match | +20 / −24 | 160,927 B |

C is a runtime-guided adjustment after B's adverse comparison and CPU/JIT investigation. B asks `replace` to return the original full text, despite discarding that result. C consumes the complete source and makes the final returned value empty, while retaining identical row writes. This also changes matching work and per-row endpoint derivation; it is **not** an isolated measurement of output-string allocation. Logical string lengths below do not prove native allocation sizes or whether V8 reuses a string.

## Controlled throughput

Node **26.13.0**, absolute executable, Apple M1 Pro, `taskpolicy -c utility`. Each comparison has four alternating ABBA/BAAB blocks, fresh processes/modules, 250 ms warmup, full GC, 150 ms settling, approximately 300 ms measurement with natural GC included, 500 ms phase cap. No own build/test/profile overlaps throughput. All 64 unprofiled observations are retained. Neither run is an M3 replication.

Positive means slower:

| Comparison | Spec | 95% CI | Examples | 95% CI |
| --- | ---: | --- | ---: | --- |
| A → B | +44.184% | [+42.248%, +46.145%] | +20.888% | [+19.219%, +22.579%] |
| A → C | +38.106% | [+35.640%, +40.618%] | +22.125% | [+19.215%, +25.105%] |

These independent A/B and A/C results are not subtracted into an isolated B/C speedup. Both candidates fail primary performance admission. Broader incremental/CSP throughput is not run to try to offset these regressions.

## Executed work and V8 attribution

Instrumented public parsing, excluded from throughput, confirms the same **9,756 spec rows and 39,024 field writes** in all variants:

| Spec work | A | B | C |
| --- | ---: | ---: | ---: |
| Literal-search calls inside physical scan | 9,758 | 0 | 0 |
| Replacement callbacks | 0 | 9,756 | 9,757 |
| Zero-length callbacks | 0 | 0 | 1 |
| Total matched UTF-16 code units | — | 9,756 | 204,706 |
| Discarded replacement result, UTF-16 code units | — | 204,706 | 0 |

Thus reducing JavaScript calls to `indexOf` does not eliminate per-row execution: callback dispatch takes its place. Matching and callback inputs introduce a different intermediate path, while the entire packed representation remains. The probe does not count native regex comparisons, hidden match queues, allocated bytes or backing-string copies. Generated/CSP counters agree and preserve complete AST/positions on all 655 corpus documents per variant/backend, including the benchmark feature profile for Rust/APIs.

Two separate four-block CPU diagnostic groups retain raw profiles, clock audits and ±100 μs clipping sensitivity:

| Diagnostic group | A scan self samples | Candidate scan self samples | A observed GC | Candidate observed GC |
| --- | ---: | ---: | ---: | ---: |
| A/B | 178.98 μs/parse | 499.06 μs/parse | 19.53 μs/parse | 22.84 μs/parse |
| A/C | 228.38 μs/parse | 508.79 μs/parse | 19.71 μs/parse | 25.57 μs/parse |

The scan self samples include work attributed to its native calls, not only JavaScript statements. V8's independent JIT trace observes `append` inlined into each replacement callback and the smaller scanner inlined into `parse` for both candidates. The regression cannot simply be described as an uninlined append helper. No measured bailout or invalidation appears in these four JIT runs; measured optimization completions remain (A/B: 7/5, A/C: 6/5), so quiescence is not established.

Profiled elapsed means are approximately 920.71 → 1,322.30 μs for A/B and 918.19 → 1,264.40 μs for A/C. Observed GC growth is much smaller than these elapsed increases. This supports investigating scanning/callback execution rather than attributing the result solely to GC. Sampling, inlining and runtime overhead prevent an additive causal decomposition; the exact division among matching, callback dispatch, captured state and hidden native intermediates remains unresolved. No claim that a particular implicit string copy explains a specific percentage is made.

## Validation, restoration and repeat gate

Both variants pass build and typecheck. Each passes, separately in generated and forced-CSP modes, 2,614 full corpus AST/position comparisons, 4,608 feature edits, 612 definition documents / 4,284 edits, existing delimiter/bracket guards and 3,072 indented-code matrix documents / 6,144 edits. Candidate C also passes all **198 existing tests**. The complete repository suite was not independently run on B. No parser-private repository test is added.

After C's validation the original `lines.ts` is restored and rebuilt. Production source and bundle match the frozen baseline exactly. No rejected implementation, revert commit, worktree or push remains. Only the consolidated records commit is amended.

Do not retry ending callbacks, whole-row callbacks, returning a different ignored replacement string, or removing the append helper merely to chase a different inlining shape. Both native batching variants retain all row materialization and replace one per-row invocation pattern with another. Reopen only if a consumer change removes row production or a materially different execution path avoids these callback/intermediate costs. The separate historical regex-test/sticky-stream regressions are not overwritten by this result.

`native-line-callback-05fdacf-node26-m1pro.json` preserves source patches, bundles, all observations, CPU/JIT/GC data, scripts, work counters and validation. Canonical variants are `candidate-B.mjs` and `candidate-C.mjs`. The validation/build alias `candidate.mjs` first contained B, then C; the B validation snapshot is under `validation-B/`, and the remaining validation outputs describe C. The initial benchmark's candidate hash identifies B despite its original alias path. Reproducing a validator requires selecting the intended canonical variant as that alias. No sample from one variant is presented as another's result.
