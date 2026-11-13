# Physical line discovery with one native stream

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Neither candidate is retained. The accepted parser remains `b27a41d`; the four incoming paragraph/shortcut edits remain unstaged and byte-identical. This experiment does not establish a new remark multiplier.

The intended simplification was to replace the LF/CR search streams and their merge logic without changing the four-field physical line table, projected views, batch consumers or incremental EOF-relative suffixes. Unlike the earlier `String.split` experiment, these candidates allocate no match arrays or per-line strings.

| Variant | Discovery | Production bundle |
| --- | --- | ---: |
| A | Existing exhausted LF/CR `indexOf` streams | 162,777 B |
| B | One `/[\r\n]/g` search stream, with CRLF consumption | 162,572 B |
| C | Consume complete lines with `/[^\r\n]*(?:\r\n?|\n|$)/y` | 162,515 B |

C was implemented after B's regression and runtime investigation, to test direct line consumption instead of unanchored boundary discovery. All changes were isolated to `src/block/lines.ts`. No minification changes, feature API, metadata, ownership transfer or codegen removal were involved.

## Measurements

Node 26.13.0, M1 Pro, `taskpolicy -c utility`, fresh processes/modules, alternating ABBA/BAAB, 250 ms warmup, full GC, 150 ms settling and approximately 300 ms measured windows including natural GC. Every comparison below contains four blocks. Builds, tests and profiles did not overlap throughput. Every observation is retained. Maximum unprofiled window: **298.886 ms**. This is not an M3 replication.

Positive means more elapsed time:

| Comparison | Input | Change | 95% CI |
| --- | --- | ---: | --- |
| A → B | spec | +8.773% | [+4.641%, +13.068%] |
| A → B | examples | +4.261% | [+3.775%, +4.750%] |
| A → C | spec | +9.281% | [+6.165%, +12.488%] |
| A → C | examples | +5.272% | [+3.535%, +7.038%] |
| A → B, **diagnostic `--no-turbo-inlining`** | spec | +2.629% | [+1.480%, +3.791%] |

The altered-runtime control is not a production admission result. It demonstrates that changed inlining is not the only cost, but cannot partition the original regression by subtracting percentages between protocols. Broader admission guards were not run after both primary cases regressed.

## Runtime attribution

Counters injected into frozen bundles and exercised through public corpus parsing show that all three variants still create **9,756 physical records and perform 39,024 field writes** for spec. Native search calls fall only from **9,758 to 9,756**. For the examples corpus, calls fall from 2,878 to 1,574, while all variants retain the same 1,574 records and 6,296 writes. These counters do not measure native character comparisons.

Independent CPU profiles, each with four alternating blocks, show:

| Diagnostic | A | Candidate |
| --- | ---: | ---: |
| B: `#scan` self samples, μs/parse | 258.825 | 290.693 |
| B: GC, μs/parse | 23.823 | 26.600 |
| C: `#scan` self samples, μs/parse | 251.304 | 299.642 |
| C: GC, μs/parse | 26.292 | 25.218 |

Sampling overhead is visible elsewhere in the profiles; these values are not an additive decomposition of unprofiled elapsed time. B's trace observes `#scan` inlining into `parse`, whereas A's trace does not. Both scanners optimize during warmup, with no observed scanner deoptimization in the measured phase. Other functions still complete optimization during measurement, so the protocol does not prove JIT quiescence. The no-inlining control above retains a resolved regression.

The supported conclusion is narrow: replacing the existing native literal searches with either matcher does not improve this pipeline. It removes merge control flow but does not remove the line representation or its per-row work. Do not retry these patterns unchanged. This does not reject a future architecture that actually eliminates materialization or consumer work.

## Validation and preservation

B passes all **194 existing tests**. B and C each pass **2,614 complete corpus AST/position comparisons and 4,608 feature edits per backend**, using generated and forced-CSP execution. Feature edits compare incremental trees against fresh parse results. Public declarations are byte-identical. C was not separately run through the entire existing test suite. No parser-private tests were added; work counters are diagnostics only.

The final working source and bundle match their incoming hashes. The two candidate implementations remain only in the research archive, together with all 64 ordinary observations, 16 no-inlining diagnostic observations, 32 CPU profiles, JIT/native-regexp logs, source snapshots, bundles and scripts:
`line-ending-stream-research-b27a41d-node26-m1pro.json`.

Two ideas were screened without implementation: uniform EOF-relative coordinates would move rewriting cost to retained prefixes on tail edits; wholesale deletion of remaining literal tokens would alter decorator ordering because ordinary unmatched gaps are already implicit. Neither screening has a timing result.
