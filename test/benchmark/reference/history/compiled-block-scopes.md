# Compiled block scopes: attribution and disposition

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

The experiment is closed without a new source commit. B and C were implemented visibly on `main`, validated, measured and inspected with V8 logs, then removed. The four incoming paragraph/heading/shortcut edits remain byte-identical. Accepted parser source remains `69240f6`.

## Current target measurement

A fresh eight-block alternating ABBA/BAAB comparison of the **accepted `69240f6` bundle**, excluding pending work, against `mdast-util-from-markdown` measures **80.8408×** on CommonMark spec, with a 95% ratio interval of **79.9772×–81.7138×**. Mean observation times are 944.697 μs for the parser and 76,377.832 μs for the reference. These are this M1 Pro run's absolute times, not M3 estimates or replacements for historical measurements.

At the point estimate, reaching 100× requires approximately **19.159% less parser time**, holding the reference fixed. The raw comparison is in `remark-69240f6-node26-m1pro.json`. Its source hash is `dd573943f5aec969f0295f202a6d254c19f9a11628df078a982e0a29c0717695`; future comparisons must verify the source/protocol binding rather than transfer this ratio to arbitrary working changes.

## Focused change

The original core scans leading whitespace, skips blank lines, calls a generated block dispatcher and reports the block's line/token range. B compiles the complete scope loop into the profile, replacing `BlockProfile.dispatch` with `scan`. The existing context method delegates to it. Grammar registrations, feature start signatures, tokens, source positions, AST construction and edit convergence are unchanged.

C shares leading-whitespace/indent classification between generated and CSP paths in a private `blockContentOffset` function. It tests whether a smaller generated body and one implementation of the classification improve the runtime tradeoff observed in B.

Both comparisons use a frozen **main-A combination**, which includes the pre-existing pending candidates in both sides. This isolates the scanner experiment; it is a different scope from the accepted-source remark comparison.

| Variant | Bundle bytes | Delta vs main A | Spec, four blocks | Examples, four blocks |
| --- | ---: | ---: | --- | --- |
| Main A | 161,298 | — | — | — |
| B: whole compiled scope | 161,691 | +393 | +4.56%, CI [−2.76%, +12.43%] | −0.49%, CI [−1.28%, +0.31%] |
| C: shared classification | 161,641 | +343 | +1.80%, CI [−0.01%, +3.65%] | −1.94%, CI [−2.74%, −1.12%] |

B Rust is −0.55%, CI [−4.65%, +3.73%]. No isolated C→B timing comparison was made, so these independent A comparisons must not be subtracted to claim the exact effect of extracting the helper. No eight-block source confirmation or broad admission run followed: neither implementation establishes spec benefit, and both fail the no-growth requirement. The positive examples result alone is insufficient.

## Runtime evidence

An untimed Function-construction probe confirms both generated block programs compile successfully. On the same spec AST, A enters the block dispatcher 1,561 times. B enters its compiled scope 119 times and still processes 1,561 blocks. This removes source-level dispatch crossings, not block recognition or token work.

Separate fresh-process CPU/JIT diagnostics preserve the original functions. A preload captures the actual generated function's SharedFunctionInfo via `%DebugPrint`, without renaming or modifying its body, to distinguish it from unrelated anonymous callbacks in the inlining log.

- A's generated dispatcher is rejected for inlining into its caller because it exceeds the bytecode limit. Thus it would be incorrect to claim V8 had already eliminated that whole dispatch call.
- In the identified A run, `closesFence` is inlined into the generated dispatcher. In the identified B run, that edge is absent; other callees, including `fenceAt`, are inlined into the larger scope instead.
- C inlines `blockContentOffset` back into the generated scope and still has no observed `closesFence` edge into that function. The generated scope remains too large for some callers to inline.
- Separate A/B CPU samples show `closesFence` self time around 50.90/54.14 μs per parse, but costs also move in unchanged line scanning, inline boundary search and location lookup. GC observations are 23.63/23.98 μs per parse. This does not precisely account for the throughput result or prove a single inlining decision caused it.
- Both ordinary diagnostic JIT logs invalidate four dependent codes after warmup GC and ten during settling; both complete six optimizations during measurement. The windows are not established JIT-quiescent periods.

The useful finding is a changed optimization boundary, not a general rule that fewer calls or larger generated functions are faster. The experiment did not eliminate any line, block or token intermediate representation.

## Validation and protocol

B/C each pass 196 existing public syntax/edit tests and typecheck. B passes changed-file lint. Each passes 2,614 public AST/position comparisons and 4,608 feature edits with CSP forced; B also passes the corpus matrix with codegen enabled. New repository tests targeting private scanner structures were not added. No parser correctness claim is inferred from the diagnostic counters.

All benchmark/test/build/profile commands use `taskpolicy -c utility`, Node 26.13.0 on M1 Pro. Throughput uses fresh process/module state, alternating ABBA/BAAB, 250 ms warmup, full GC, 150 ms settling, approximately 300 ms measured windows including natural GC, and a 500 ms cap on each window. Own tests/builds/profiles do not overlap throughput. Instrumented CPU/JIT/counter runs are diagnostic only.

The normal results, frozen bundles, source snapshots, tests, CPU profiles, JIT logs and identified-function evidence are preserved in `compiled-block-scopes-69240f6-node26-m1pro.json`.

## Repetition boundary

Do not retry the same whole-scope fusion or shared-classifier variant by renaming helpers, changing inlining thresholds or extending warmup until a favorable batch appears. Reopen only if the profile compiler or grammar consumption changes enough to remove actual work or the relevant runtime evidence changes.

The earlier numeric delimiter-replacement/implicit-order route (candidate 21), partial ordinary-bracket pass fusion, native fence searches, lazy four-field line filling and current-row adapters were screened against their historical records and were not reimplemented here. This experiment does not invalidate those conclusions. The 100× goal remains active and unmet.
