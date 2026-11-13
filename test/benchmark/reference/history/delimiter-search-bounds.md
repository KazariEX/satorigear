# Preserve delimiter search bounds after unlinking

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Retained source: `b208563` — `perf: preserve delimiter search bounds after unlinking`.

The retained candidate H preserves the single delimiter chain and makes failed-search bounds independent of node lifetime. A repeated mixed-delimiter guard improves **62.96%**, CI [−63.12%, −62.80%]. Spec changes −0.10%, CI [−0.65%, +0.45%]: no established spec gain. No new remark reference was measured; the 100× goal remains unmet.

Production changes only `packages/satorigear/src/inline/delimiter.ts`: 13 lines added / 13 removed. One public syntax/position test is added in `test/mdast-conformance.test.ts`. The unminified bundle decreases from 161,149 to **161,137 B**. There is no new feature API, run field, collection, parsing pass or persistent cache. Codegen and CSP remain supported.

## Root cause and the retained invariant

Previously a failed search saved `closer.previous`, then subsequent searches stopped only when they encountered that exact node. Matching can remove the node from the active chain. When this happens, traversal passes the already-excluded range and repeats previous failures. This issue predates direct object links: the earlier numeric-index implementation also used equality with a saved node index rather than an ordered boundary.

H stores the failed closer's stable raw token index. A later search visits only nodes whose indices are at least that bound. The current failed closer stays eligible as a future opener, so equality is inclusive. The index belongs to the existing raw token stream; no new ordinal is assigned or maintained.

The failure class already contains delimiter configuration, the closer's original can-open flag and original length modulo three. Pair eligibility depends on these fixed facts and the opener's fixed flags/modulo, not its mutable remaining length or start. After a failed search, every earlier candidate has either failed now or been excluded by the prior bound. Later matching may remove candidates but cannot make an excluded candidate compatible with the same class. A stable source-order bound preserves that negative result even when its former boundary node disappears.

The loop also removes the duplicate `current` alias and saved `next`: `unlinkRun` changes neighboring links, never the current node's own next link. An explicit numeric annotation on `bottomSlotBase` prevents recursive TypeScript inference without changing emitted code. Pairing, replacement publication, bracket scope ownership and raw/resolved streams are otherwise unchanged.

An instrumented public parse of `_a*b_c**d***e_f `.repeat(N), with complete AST/position equality, finds:

| Repetitions | Baseline opener visits | Visits below a removed boundary | H opener visits | Pair checks, both |
| --- | ---: | ---: | ---: | ---: |
| 100 | 5,450 | 4,950 | 500 | 300 |
| 200 | 20,900 | 19,900 | 1,000 | 600 |
| 400 | 81,800 | 79,800 | 2,000 | 1,200 |
| 800 | 323,600 | 319,600 | 4,000 | 2,400 |

Thus this input family's quadratic repeated search becomes linear. This is not a proof of every extension's worst-case complexity. Spec still has 103 opener visits / 103 pair checks, Rust 45 / 45, formatting 2,000 / 2,000 and nested scopes 800 / 800. Generated and forced-CSP probes agree. The mixed syntax also matches the reference parser's complete AST/positions at repetitions 2, 4 and 8.

## Why per-configuration stacks were not retained

The initial direction linked openers separately by configuration, kept source-order traversal and pruned all configuration heads after a match. It removed most mismatch work, but added an opener-head array per scope and a second maintenance process. These runtime regressions were investigated and adjusted before abandoning that representation:

| Candidate, four blocks per guard | Formatting | Nested scopes | Mismatch | Reference edit |
| --- | ---: | ---: | ---: | ---: |
| E: per-configuration opener stacks | +3.22% | +1.42% | −62.54% | +3.16% |
| F: lazy failure table, prune writes only on change | +1.88% | +1.50% | −62.46% | +3.97% |
| G: try a compatible stack head before reading failure bounds | +0.93% | +0.81% | −63.06% | +2.80% |

E's formatting/scopes/reference-edit intervals exclude zero on the slower side. F/G still have resolved scope/reference-edit regressions. All observations remain archived; F/G have no stock-corpus throughput claim. E's separate stock screen has no resolved change, including spec −0.26%.

E CPU profiles show matching self time rising about 41.63 → 63.52 μs on formatting and 18.14 → 26.85 μs on nested scopes. Formatting GC remains about 41.36 → 41.53 μs per operation. This supports extra matching maintenance as a contributor, rather than attributing every regression to allocation or noise. Counters find 401 failure tables with no stored bounds in the scopes case, motivating F; trying compatible heads first motivates G. Neither adjustment fixes all regressions. The new lost-bound probe then identifies a narrower representation correction that retains the original single chain and removes the redundant search.

Untimed B/C/D prototypes and their source/bundles are preserved. C fails typecheck on recursive `configIndex` inference; D adds an explicit annotation. B/D pass generated topology checks. E passes the broader checks and 197 then-existing repository tests. H is the only retained production variant. The per-configuration branches, compiled-config changes and pruning machinery are completely absent from production.

Do not repeat E/F/G unchanged. A future reconsideration needs a changed ownership/search premise that accounts for their scope/reference-edit cost. The old lazy-workspace experiment was not accepted here either: F concerns the extra structures of this different algorithm and still fails admission.

## Strict throughput comparison for H

Node 26.13.0 / Apple M1 Pro, every execution under `taskpolicy -c utility`. Alternating ABBA/BAAB with independent processes/modules, 250 ms warmup, full GC, 150 ms settling and approximately 300 ms measured including natural GC. Every phase is capped at 500 ms. No own builds, tests or profiles overlap throughput. These are not M3 measurements.

All first four blocks and the independent eight-block confirmation are retained. Estimates use paired block log ratios, with Student t intervals. Positive means slower. Twelve-block rows combine the two batches; the other rows retain their four-block screen.

| Workload | Blocks | Change | 95% interval |
| --- | ---: | ---: | --- |
| spec | 12 | −0.10% | −0.65% to +0.45% |
| examples | 12 | +0.31% | −0.34% to +0.98% |
| Rust | 4 | −0.89% | −2.12% to +0.35% |
| APIs | 4 | −0.37% | −2.06% to +1.34% |
| document/spec | 4 | −0.58% | −1.90% to +0.77% |
| tail edit | 4 | −1.40% | −5.13% to +2.48% |
| formatting | 12 | −0.42% | −1.34% to +0.52% |
| nested scopes | 12 | −0.27% | −0.66% to +0.12% |
| mismatch | 12 | −62.96% | −63.12% to −62.80% |
| reference availability edit | 12 | −0.57% | −1.20% to +0.07% |

Spec observation means are 909.295 → 908.348 μs; mismatch 1,528.202 → 566.019 μs. Initial mismatch was −63.11%, independent confirmation −62.88%. Examples was +0.86% initially and +0.04% in confirmation. No observation is removed or substituted. Cross-zero intervals do not prove equivalence or universal non-regression; small effects, especially the four-block rows, remain uncertain. The candidate is retained for the simpler, durable bound semantics and confirmed algorithmic gain, with no resolved regression in the tested cases.

## CPU, JIT, GC and actual object layout

Separate four-block CPU profiles for spec, examples, formatting, scopes and mismatch use fresh processes and the same phases. They are attribution evidence, not throughput admission:

| Workload | Profiled elapsed, A → H | Matching self samples, A → H | Observed GC / operation, A → H |
| --- | ---: | ---: | ---: |
| mismatch | 1,548.17 → 567.96 μs | 1,004.59 → 49.97 μs | 30.75 → 30.63 μs |
| formatting | 528.66 → 536.05 μs | 38.79 → 39.47 μs | 41.08 → 41.00 μs |
| nested scopes | 307.10 → 306.49 μs | 18.97 → 17.07 μs | 14.37 → 14.51 μs |

Together with the counters, mismatch samples localize the dominant saving to eliminating repeated failed searches, not GC removal. Formatting's profiled elapsed direction differs from unprofiled throughput; neither diagnostic elapsed nor sampled stacks replace the admission result. Its matching cost no longer shows E's substantial increase. Scope matching similarly avoids E's maintenance cost.

Examples profiles change 608.60 → 603.96 μs, opposite its small adverse unprofiled estimate; observed GC changes 19.18 → 19.52 μs. This does not identify a stable candidate-specific regression or prove zero risk. Spec profiles change 919.26 → 916.00 μs. No gain is inferred from these diagnostic times.

All ten inspected measurement JIT traces contain no bailout or dependent-code invalidation. Optimization completions still occur: spec 6/7, examples 14/14, formatting 0/1, scopes 0/0, mismatch 0/0. Warmup/settling contain deoptimizations and invalidations, so this is not a claim of global JIT quiescence.

Phase-separated GC traces show why raw totals are not interchangeable with per-operation cost. Mismatch has 20 versus 53 scavenges (6.24 versus 14.84 ms total pause), while H completes many more parses. Formatting has 67 scavenges versus 58 plus two major collections (22.01 versus 36.02 ms). Natural GC remains included; no universal GC improvement is claimed.

V8 `%DebugPrint` confirms runs remain 80 B with seven in-object properties. Eight inspected mixed runs share one map within each variant/backend cohort. The nonempty failure table changes from `HOLEY_ELEMENTS` to `HOLEY_SMI_ELEMENTS`. Per-parse run and failure-table counts are unchanged: spec 206/48, Rust 123/70, APIs 104/52, formatting and mismatch 3,200/1. H has no opener-head arrays. These observations do not claim identical GC reachability or an exact allocated-byte saving.

## Validation, records and the next performance boundary

198 repository tests, build, typecheck, changed-file lint and whitespace checks pass. Build/typecheck run sequentially. Final dist is byte-identical to frozen `candidate-H.mjs`, SHA-256 `f66c3a4f9f17b5c2a34b4e67b8ac0bb738cf24bfd24933d0e0b008db91cecc75`. The final source adds explanatory comments after freezing; rebuild confirms they do not alter measured bytes.

Each backend passes 54,092 topology plus 46,812 delimiter-matrix full AST/position comparisons, 2,614 corpus comparisons, 612 definition-related documents / 4,284 edits, 4,608 feature edits, 12 previous guard documents / 24 edits and nine delimiter guard documents / 36 edits. These frozen-bundle probes remain diagnostics, not parser-private repository tests. The added repository test compares public mixed-emphasis syntax with the reference parser including positions. The official-corpus repository test separately compares semantic trees without positions.

The archive contains all **640** unprofiled observations: E 160, F 64, G 64, H 352; the longest measured window is 299.410875 ms. It includes all prototype bundles/source, setup failures, validation logs, work counts, removed-bound witnesses, V8 layouts and CPU/JIT/GC records. H confirmations are combined only with H, never pooled with E/F/G. Harness label B denotes its candidate, while filenames `candidate-B/C/D` are untimed earlier prototypes. Shared summary filenames from validation contain the latest H results; earlier variant-specific logs preserve their outcomes.

The new spec CPU profiles still concentrate samples in physical line scanning and inline boundary search: H has about 196.53 μs in `#scan` and 102.56 μs in `nextBoundaryOffset`. These are sampling observations, not recoverable-time guarantees or permission to repeat rejected line-table/regex variants. The current correction barely changes spec's search work. Advancing the 100× objective therefore needs a distinct focused evolution that reduces production or repeated interpretation of those inputs while preserving the established row/source semantics. This experiment does not establish that next design.

Source is committed on main with KazariAI identity and title only. Evidence is folded into the existing trailing consolidated-record commit. No development worktree, revert commit or push is used.
