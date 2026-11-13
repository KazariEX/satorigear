# Start inline resolution at the first raw token

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Retained source: `2c1b10c` — `perf: start inline resolution at the first raw token`.

The retained candidate C reuses the first raw token's index as the entry point for bracket analysis and pairing. A long semantic-prefix guard improves **3.09%**, CI [−3.49%, −2.69%]. Spec changes +0.16%, CI [−0.23%, +0.55%]: no established spec gain. No new remark reference is measured; the 100× goal remains unmet.

Only `packages/satorigear/src/profile/resolve.ts` changes: 16 lines added / 12 removed. The unminified bundle decreases from 161,137 to **161,093 B**. There is no new object, field, collection, token representation, feature API, cache or source-ownership protocol. Generated and CSP tokenizers are unchanged.

## Reuse the already-established boundary

Previously the resolver searched backward for any raw token to decide whether structural resolution was necessary. After finding one, both bracket analysis and pairing restarted at token zero. Already-semantic prefixes were traversed again even though they cannot introduce an opener or delimiter run.

C finds the first raw token from the front and passes that index plus the already-known stream length to the two private resolution functions. Both start at that index. Final emission still visits the original complete stream, including the semantic prefix; no slice or copy is introduced. Entirely semantic streams still return their original token array.

The omitted prefix cannot contain an image/bracket opener or raw delimiter because their kinds are below `InlineRole.Text`. A leading `LinkTail` is already literal semantic text when no preceding raw opener exists; it cannot create a pending bracket. A semantic component token directly before the first bracket remains available to the feature's existing `tokenIndex - 1` lookup because indices and the underlying stream are unchanged. Prefix decorators are still emitted and applied in the original order. No bracket state, delimiter scope, definition query or replacement is established by this prefix.

An earlier untimed B draft bounded both ends of resolution. A trailing `LinkTail` must remain inside such a range because it can close an earlier opener even though its kind is semantic text. The additional tail-classification loop grew the bundle by 91 B, so it was not admitted. Its typecheck passed, but no full syntax/performance qualification is claimed. C retains only the entry boundary, removing the additional tail-classification loop. B's source and bundle remain archived; it has no measured performance conclusion.

## Actual work through public parsing

Generated and forced-CSP probes produce identical counters and full AST/positions. These are executed source-operation counts, not machine instructions or timings:

| Input | Precheck visits A → C | Bracket-analysis visits A → C | Pairing visits A → C |
| --- | ---: | ---: | ---: |
| spec | 694 → 467 | 1,356 → 1,325 | 1,356 → 1,325 |
| examples | 539 → 471 | 942 → 932 | 942 → 932 |
| Rust | 12,412 → 7,033 | 22,541 → 22,313 | 22,541 → 22,313 |
| APIs | 4,665 → 2,693 | 3,934 → 3,934 | 3,934 → 3,934 |
| 800 code spans, then emphasis | 1 → 801 | 802 → 2 | 802 → 2 |
| emphasis, then 800 code spans | 801 → 1 | 802 → 802 | 802 → 802 |
| 800 code spans only | 800 → 800 | 0 → 0 | 0 → 0 |

Token and resolution-entry counts are unchanged. The long-prefix case moves one scan to the front but removes two redundant scans over the same prefix. The suffix case eliminates the old backward precheck over the semantic suffix without shortening the other two passes. This difference is why both directional guards and a fully semantic control are measured.

## Strict throughput comparison

Node 26.13.0 / Apple M1 Pro, `taskpolicy -c utility`, alternating ABBA/BAAB, fresh process/module per observation, 250 ms warmup, full GC, 150 ms settling and approximately 300 ms measured including natural GC. Every phase is capped at 500 ms. No own builds, tests or profiles overlap throughput. These are not M3 results.

All first four blocks and independent eight-block confirmations are retained. Changes use mean paired block log ratios and Student t intervals. Positive means slower; twelve-block rows combine both batches. Tail edits and the semantic-only control retain their four-block screen.

| Workload | Blocks | Change | 95% interval |
| --- | ---: | ---: | --- |
| spec | 12 | +0.16% | −0.23% to +0.55% |
| examples | 12 | +0.41% | −0.22% to +1.05% |
| Rust | 12 | +0.51% | −0.49% to +1.52% |
| APIs | 12 | +0.52% | −0.75% to +1.81% |
| document/spec | 12 | +0.25% | −0.15% to +0.65% |
| tail edit | 4 | −0.36% | −0.85% to +0.14% |
| long semantic prefix | 12 | −3.09% | −3.49% to −2.69% |
| long semantic suffix | 12 | +0.08% | −0.15% to +0.32% |
| semantic tokens only | 4 | +0.18% | −0.68% to +1.05% |

The initial suffix result is **+0.53%, CI [+0.16%, +0.89%]**, and is not discarded. It motivated runtime investigation and an independent confirmation. The combined result does not establish a regression, but does not prove exact equivalence either. All stock-corpus point estimates are slightly adverse; their crossing-zero intervals must not be reported as a stock-corpus benefit or universal non-regression. The retained justification is the explicit reuse of an existing boundary, smaller bundle and independently confirmed prefix gain, with small broader effects unresolved.

No native diagnostic, instrumented parse or altered-runtime result substitutes for the throughput observations. There is no minimum-gain threshold or repeated sampling until an estimate becomes favorable.

## Runtime attribution and a hypothesis that was not supported

Separate four-block CPU profiles use the same workload and phase setup. The long-prefix result is consistent with the intended work reduction:

| Diagnostic, μs per operation | A | C |
| --- | ---: | ---: |
| Prefix elapsed under profiling | 116.69 | 112.87 |
| Prefix `resolvePairedSyntax` self samples | 4.11 | 0.62 |
| Prefix `analyzeBrackets` self samples | 0.94 | 0 sampled |
| Prefix observed GC | 3.24 | 3.05 |
| Suffix elapsed under profiling | 114.80 | 115.38 |
| Suffix `resolvePairedSyntax` self samples | 2.62 | 2.56 |
| Suffix observed GC | 3.93 | 3.98 |

Zero samples do not mean zero execution. Prefix still visits two tokens per structural pass. Sampling and profiler overhead prevent additive attribution of the whole elapsed difference.

The suffix profile does not expose a large new pairing or GC cost. Shifts occur among unchanged projection routines. On spec/APIs, however, matching samples rise despite reduced source-operation counts: `analyzeBrackets` approximately 5.00 → 10.75 / 12.27 → 17.97 μs, and `resolvePairedSyntax` 10.11 → 13.59 / 29.34 → 37.31 μs. These are not ignored, nor assumed to be causal wall-time changes: other unchanged stacks shift substantially and API profiled elapsed changes 2,827.60 → 2,821.01 μs, opposite its small adverse unprofiled estimate.

A specific hypothesis was that passing the stream end as an argument removed V8's array-bound proof. Four independent native-code diagnostic processes inspect the two functions under the API workload:

| Optimized function | Machine code A → C | Emitted out-of-bounds deopt sites A → C |
| --- | ---: | ---: |
| `analyzeBrackets` | 1,636 → 1,588 B | 1 → 1 |
| `resolvePairedSyntax` | 6,760 → 6,728 B | 8 → 8 |

This does not support a claim that the candidate adds more array-bounds guards. It also does not prove identical instructions, checks at identical locations or equal execution cost. Emitted deopt sites are guards, not observed bailouts. No extra branch, alternate parameter strategy or speculative rescue variant is added on this evidence.

The CPU/JIT runs show no measurement bailout or dependent-code invalidation on spec, prefix or suffix. API has one measurement `scan` bailout for out-of-bounds on each side, outside the two changed functions. Optimization completions still occur during measurement: spec 6/6, API 10/9, prefix 4/4, suffix 5/5. Warmup/settling contain invalidations and deoptimizations; global JIT quiescence is not established.

Phase-separated GC logs remain part of the evidence. For example, API has 6/7 major collections and 11/12 scavenges, with total measured pauses about 41.94/45.80 ms in the individual traces. These totals do not replace aggregate per-operation measurements or establish a universal GC direction. All normal elapsed observations include natural GC.

## Validation and retained state

198 existing tests, typecheck, changed-file lint and whitespace checks pass. Each backend also passes 54,092 topology plus 46,812 delimiter-matrix complete AST/position comparisons, 2,614 corpus comparisons, 612 definition-related documents / 4,284 edits, 4,608 feature edits, previous guards, and 18 new public-syntax guard documents / 36 edits. The new guards include long prefixes/suffixes, semantic-only input, resource links, component labels/attributes and reference-definition insertion/undo. No parser-private repository tests are added.

The final production bundle is byte-identical to the frozen measured C, SHA-256 `647a800e21901ec1455291689ca40e330115d43ddb15946efffc118d2e759f64`. Source is committed on main with KazariAI identity and title only. The only trailing records commit is amended; there is no worktree, revert commit or push.

`resolution-window-d5da408-node26-m1pro.json` preserves **368** normal observations (144 initial, 224 independent confirmation; longest window 299.312167 ms), both source variants, frozen bundles, all validation, counters, CPU/JIT/GC/native-code output and scripts. Two setup failures occur before parser/timing execution: Node refuses the initial `.mts` diagnostic under node_modules, and an instrumentation assertion expects an expression that the bundler had folded. The corrected `.mjs` runner and scoped condition instrumentation pass; the original scripts are retained.

This change does not solve shared boundary discovery or the dominant physical-line/native-search cost in spec. Those remain separate architectural questions. Do not retime this unchanged prefix-entry candidate to chase a spec claim, or retry the two-sided draft as an admitted optimization without satisfying its extra-classification and bundle costs.

Follow-up: [semantic prefix emission](semantic-prefix-emission.md) reuses this established boundary in the output stage, with independent measurements and an empty-prefix regression adjustment. Those later gains are not part of this commit's results.
