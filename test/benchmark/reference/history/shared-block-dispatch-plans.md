# Shared block dispatch plans

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Status: not admitted. The experiment was implemented on `main`, profiled, adjusted and removed. The working source is again the exact Q version requested for review, with bundle SHA256 `263684f7dd4985a76f85fbebee4a83eb69c34310a5eaf95ce324ac00aad2f7ee` (160,358 B). Q's known middle-edit regressions remain; restoring it for review does not admit those regressions. Historical accepted source `69240f6` remains in Git history. Its remark ratio does not describe this different working source.

Subsequent worktree update: exact-Q review has ended. `main` now matches accepted Q+D (`69240f6` source, 160,583 B, SHA256 `dd573943f5aec969f0295f202a6d254c19f9a11628df078a982e0a29c0717695`). The Q restoration mentioned below describes this experiment’s historical disposition, not the current worktree.

## Intent and model

Multiple block-start characters can select identical ordered rule sequences. The experiment compiles those sequences into shared switch branches and binds each distinct handler once. Default generated branches fall from 21 to 9. Registrations, tokens, AST construction, source positions and edit convergence retain their existing contracts; no feature API is added.

The first implementation uses a captured handler table. The CSP interpreter appends fallbacks to its locally owned chains at compilation, then executes a single chain. The adjusted implementation retains shared branches but captures handlers directly as individual factory arguments, removing runtime table reads. These changes affect profile compilation and dispatch, not the amount of grammar recognition performed.

## Throughput and comparison scopes

Node 26.13.0 on M1 Pro, `taskpolicy -c utility`, fresh process/module caches, alternating ABBA/BAAB, 250 ms warmup, full GC, 150 ms settling, about 300 ms measurement including natural GC. Every measured window is below 500 ms. Own builds, tests and profiles do not overlap throughput. CPU/JIT/counter runs are separate diagnostics. No M3 result is claimed.

All rows below use four blocks. Percentages describe elapsed-time change; negative is faster.

| Comparison | Spec | Examples | Rust | APIs |
| --- | --- | --- | --- | --- |
| Historical main A → shared table D | −1.17% [−2.40%, +0.07%] | +0.31% [−1.57%, +2.23%] | −0.73% [−4.79%, +3.50%] | −1.32% [−3.03%, +0.42%] |
| Exact Q → shared table F | −0.49% [−4.26%, +3.43%] | +0.28% [−2.49%, +3.12%] | +3.02% [−0.39%, +6.55%] | −0.68% [−3.32%, +2.02%] |
| Shared table F → direct bindings G | +1.08% [−2.46%, +4.76%] | Not measured | −1.88% [−3.79%, +0.05%] | Not measured |

Historical main A contains accepted `69240f6` plus the older paragraph/heading/shortcut changes. F/G instead use exact Q. Do not pool those different scopes, or subtract separate comparisons to claim a Q→G effect. Cross-zero intervals are uncertainty, not evidence of equivalence.

Historical A/D sizes are 161,298/161,302 B. Exact Q/F/G sizes are 160,358/160,362/160,405 B. These are unchanged build/minification settings. The experiment does not deliver a bundle reduction; G adds 47 B relative to Q. Public declarations remain byte-identical.

## Runtime attribution and adjustment

An untimed probe wraps actual registered handlers and compares complete ASTs and per-handler call counts. Q, F and G each call rules **1,621 times** on spec, with identical counts for every handler. Their generated source lengths are 1,390, 837 and 771 characters. Sharing generated branches removes duplicated compiled code, not grammar calls or intermediate tokens.

The identification preload captures the real generated function's SharedFunctionInfo via `%DebugPrint` without replacing its body. V8 rejects both F and G for inlining into their caller because they exceed the bytecode limit. The smaller generated source therefore does not establish an improved caller optimization boundary. Their contexts are `FunctionContext[3]` and `[11]`; the historical A/D contexts are `[26]` and `[3]`. Historical A/D both inline `closesFence` inside the dispatcher.

Separate Q/F Rust CPU runs show costs moving in unchanged line scanning, inline boundary searches and reference handling. Observed GC time is about 1,349/1,391 μs per profiled parse. These samples cannot account additively for the throughput result. Both ordinary JIT runs still complete optimizations during measurement, so neither is claimed to be JIT-quiescent.

F's generated handler-table reads introduce keyed-access feedback. This motivated the controlled F→G direct-binding adjustment rather than immediate rejection. That adjustment did not establish a throughput improvement and still exceeded the caller's bytecode inlining limit. It is not evidence that table reads caused the Rust result.

## Validation and disposition

F/G each pass 196 existing tests, typecheck, and 2,614 full AST/position comparisons in both codegen and forced-CSP modes. G passes changed-file lint. F additionally passes 4,608 public feature edits in each mode. No parser-private repository tests were introduced.

An intermediate E attempted to collect handlers with `starts.flat()`. Existing syntax/edit checks exposed that this drops the `VirtualBlockIndent = -1` property. It was fixed before throughput measurement; its smaller output is not a valid size result. `starts` is a numeric-key registry, not solely an array of nonnegative indexed entries.

No CSP throughput, construction throughput, broad incremental throughput or eight-block confirmation was run. This candidate did not reach admission. The conclusion is **benefit unestablished**, not that every possible dispatch compiler simplification has been disproven.

All snapshots, observed batches, tests and diagnostic logs are retained in `shared-block-dispatch-plans-node26-m1pro.json`. The actual source changes were made visibly in the main worktree. Removing this experiment restores exact Q; it does not discard the user's review version or the separately preserved prior work.

Do not retry unchanged grouping, array/direct binding variants, naming changes, inlining-threshold tuning or longer warmup to seek a favorable result. Reopen when the compiler eliminates actual recognition work or runtime evidence establishes a changed optimization boundary. The 100× remark goal remains active and unmet.
