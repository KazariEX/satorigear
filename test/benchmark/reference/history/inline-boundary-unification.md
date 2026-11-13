# One inline boundary search across profiles

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Accepted source: `b27a41ddb8b927926b3958061b88be56662b09ee` — `perf: unify inline boundary searches across profiles`.

The lexer previously added a leading ` {2,}[\n\r]|` alternative when a profile had more than nine markers. That alternative searched from spaces even though the LF/CR boundary already reaches the same newline handler, which recognizes the hard break and consumes its indentation. The accepted change removes that performance heuristic and its comment. Every profile now uses the same search strategy, with its registered markers substituted into the character class.

Only `src/inline/tokenize.ts` changes: one insertion, two deletions; the production bundle shrinks **51 B** (162,828 → 162,777 B). No minification change, token change, feature API, field, cache, ownership transfer or CSP/codegen distinction is introduced. Declaration files are identical.

## Accepted comparison

All timing commands used `taskpolicy -c utility`, Node 26.13.0 on M1 Pro, fresh workers/modules, alternating ABBA/BAAB, 250 ms warmup, full GC, 150 ms settling and approximately 300 ms measured windows including natural GC. The maximum across all experiments was 299.124 ms. Builds, tests and profiles did not overlap throughput. This does not replicate M3 measurements.

Negative means less elapsed time. Spec and Rust include all twelve blocks from the initial and confirmation batches; their individual reports are retained.

| Input | Blocks | Change | 95% CI |
| --- | ---: | ---: | --- |
| spec | 12 | −1.375% | [−2.381%, −0.357%] |
| Rust | 12 | −2.968% | [−4.882%, −1.016%] |
| CommonMark examples | 4 | +0.296% | [−1.901%, +2.543%] |
| APIs | 4 | −5.741% | [−8.033%, −3.392%] |
| Incremental tail edits | 4 | −0.767% | [−2.787%, +1.296%] |
| Document creation / spec | 4 | −0.472% | [−2.390%, +1.484%] |
| Long hard-break spaces | 4 | −13.349% | [−14.941%, −11.728%] |
| Dense hard-break lines | 4 | −1.436% | [−2.825%, −0.027%] |

No resolved regression was observed in these guards; intervals crossing zero do not prove equivalence. Rust varied between batches: the initial four blocks were −6.388%, while the next eight were −1.212% with a crossing-zero interval. The pooled result is not a promise of a stable 6% gain.

**The default CommonMark regex is unchanged.** Its measured spec difference cannot be attributed to fewer boundary comparisons in that configuration. Module layout, JIT and batch effects remain possible. No causal spec algorithm speedup or updated remark multiplier is claimed.

## Attribution and discarded variants

The investigation began with a semantic equivalence: discovery reads the regex match end, so consuming whitespace followed by LF can produce the same boundary as the original lookbehind. That simpler-looking expression regressed spec by **14.744%**. Boundary self samples rose from approximately 84.766 to 290.464 μs/parse despite smaller native code. Actual calls, input characters and token counts stayed equal. Expanded matching work, rather than fewer JavaScript helper calls, was the relevant cost.

Moving the context check before LF recovered spec performance in a confirmation batch, but Rust regressed **2.210%** in its confirmation. Equal-length text with no LF helped identify the interaction: the same candidate measured −2.420% with spaces under the default profile, but +3.197% with spaces under the full feature profile; letter-only controls crossed zero. The marker-count-dependent prefix admitted ordinary spaces into the matching alternatives. This supports a profile/space interaction without claiming an exact native instruction count.

Four source variants were compared with the accepted baseline:

| Variant | Meaning | Disposition |
| --- | --- | --- |
| B | Consume whitespace before LF | Spec +14.744%; not retained |
| C | Check preceding context before LF, keep the old profile heuristic | Spec confirmation −1.402%; Rust confirmation +2.210%; not retained |
| D | C plus deletion of the heuristic | Rust −3.463%, but spec +2.480% in its batch; not retained |
| E | Delete only the heuristic, retain the original LF pattern | Accepted after its own confirmation and guards |

C and D generate the same regex in the default configuration yet their spec batches differed. Those differences were not explained by regex text alone, and were not used to transfer a gain to E. All observations remain in the archive.

For E, independent Rust profiles give `nextBoundaryOffset` self samples of approximately **1,120.380 → 897.379 μs/parse**. GC time per parse is **1,390.359 → 1,353.630 μs**. These are diagnostic samples, with profiler bookkeeping visible, not an additive decomposition of the throughput result. Separate native-regexp logs show the full-profile matcher shrinking from **1,720/1,880 B to 1,448/1,600 B**. The removed root alternative no longer starts at ordinary spaces. This supports the full-profile search-cost explanation.

Short GC/JIT traces still show tier activity. No universal JIT-quiescence claim is made, and concurrent trace lines can interleave. The uncluttered native-code logs were collected separately to inspect the matcher.

## Validation and retained state

Each implemented variant passed generated and forced-CSP checks: 2,614 full corpus AST/position comparisons, 4,608 feature edits, 5,616 whitespace-boundary documents and 660 edits per backend. The accepted isolated source and the final working combination each pass all 194 existing tests; typecheck and lint pass. No parser-private tests were added.

The inherited scanner, paragraph, heading and shortcut-label changes remain unstaged and byte-identical to their incoming state. They are excluded from every admission comparison. The final working bundle includes them, so it is not the same binary as the independently measured accepted candidate.

An earlier decoded-text fusion idea was screened without implementation: spec has zero escape/entity tokens in its actual inline regions. Fusion could also send a span of 56,519 source units through decoding in a sparse-escape example. That is a cost risk, not a measured regression or a general rejection.

Full source snapshots, bundles, scripts, all **544** throughput observations, **48** CPU-profile processes, GC/JIT/native-code logs and validation outputs are archived in `inline-boundary-unification-a126216-node26-m1pro.json`. An initial cached TypeScript runner failed before starting workers; its setup failure and the equivalent generated JavaScript runner are both retained.

Do not retry B/C/D unchanged or retune the removed marker-count threshold. Preserve useful negative checks and evaluate the complete native matching alternatives. The 100× remark objective remains active and unmet.
