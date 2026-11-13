# Current main reference and physical-row demand

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

The current production bundle measures **80.032× remark**, 95% CI **[79.311×, 80.760×]**, on CommonMark spec. The 100× objective remains unmet. This is a new direct comparison, not multiplication of historical candidate gains. No production optimization is admitted by this report.

## Frozen source and protocol

Records HEAD before this measurement is `973bd9c`; accepted source commit is `2c1b10c`, with upstream `8aa9ee5`. A fresh build produces the same **161,093 B** bundle, SHA-256 `647a800e21901ec1455291689ca40e330115d43ddb15946efffc118d2e759f64`.

Node **26.13.0** is invoked by absolute executable path on **Apple M1 Pro**. This is not an M3 replication. Commands use `taskpolicy -c utility`. The unchanged `scripts/benchmark-abba.ts` runs eight alternating ABBA/BAAB blocks: 32 fresh-process/module observations, 250 ms warmup, full GC, 150 ms settling, approximately 300 ms measurement, and a 500 ms phase cap. Natural GC remains inside timing. No own build, validation or profiling runs overlap the throughput comparison. All observations are retained; the maximum measured window is **298.7925 ms**.

| Spec parser | Arithmetic mean elapsed per parse |
| --- | ---: |
| Current main | 918.455 μs |
| remark reference (`mdast-util-from-markdown`) | 73,503.013 μs |

The paired geometric ratio above is calculated from ABBA/BAAB block log ratios, not from dividing these arithmetic means. At the measured reference rate, reaching 100× would require about **19.97%** less parser elapsed time. No other-corpus performance or cumulative non-regression claim follows from this reference-only run.

## Current V8 evidence

Four independent CPU diagnostic processes use the same source and warmup/GC/settling, with 100 μs requested sampling and bounded measurement. Samples are clipped to each measured interval; the archive retains source-section/function locations, raw profiles, clock audit and ±100 μs boundary sensitivity. These are self samples, not additive causal components of unprofiled wall time.

| Function | Self samples, μs/parse |
| --- | ---: |
| Physical `BlockLines.#scan` | 269.35 |
| Inline `nextBoundaryOffset` | 104.18 |
| `locationAt` | 41.10 |
| `closesFence` | 32.63 |
| `fenceAt` | 26.97 |

One separate phase-tagged JIT/GC diagnostic observes **seven optimization completions** during measurement, with no measured bailout or invalidation in that run. This does not establish JIT quiescence. Full-GC and settling phases do observe invalidations. Profiled elapsed values do not replace the unprofiled ABBA result.

## Distinct rows, not just accessor call counts

The earlier [physical-line demand screen](line-demand-after-literal.md) counts calls. This follow-up measures distinct physical rows reached by each accessor and by direct locator reads. A borrowed physical view is mapped to its original row by its absolute source start; projected rows are counted separately. The probe records direct `locationAt` Start/End reads as well, so bypassing accessors does not hide locator demand. Borrowing a subarray is not counted as reading every field.

| Corpus | Physical rows | End accessor calls | Distinct End rows | Rows with no End read, including locator | Rows with no Next read |
| --- | ---: | ---: | ---: | ---: | ---: |
| Spec | 9,756 | 12,104 | 6,663 | 3,093 | 6,829 |
| Examples, 652 documents | 1,574 | 4,338 | 1,560 | 14 | 1,020 |
| Rust | 16,166 | 71,340 | 16,161 | 5 | 6,324 |
| APIs | 2,154 | 6,796 | 2,154 | 0 | 1,975 |

Every physical row's Start is consumed in all four corpora. Spec's locator alone reads Start 24,473 times across 9,756 distinct rows. Repeated calls therefore matter, but high aggregate End counts did not conceal an overwhelmingly unused physical End table: about 68% of spec rows and nearly every row in the other corpora use End. These are logical source-level reads, not native memory traffic, allocated bytes, or operation timings.

Generated and forced-CSP probes independently match complete ASTs and positions against the uninstrumented same-backend bundle for **655 corpus documents each**. Their demand records match exactly. No edit correctness, CR transformation or throughput claim is inferred from this stock-corpus diagnostic. No parser-private tests or public API changes are added.

## Research decision

The previous turn's upstream synchronization completed without changes. This turn adds a current direct goal measurement and runtime evidence; it is not a source optimization or a restatement of the historical reference.

Do not reopen compressed fields, derived End, lazy line filling/current-row adapters, native fence search or shared whole-source inline search solely because their associated functions remain hot. The historical regressions and consumer/ownership constraints still apply. The new distinct-row evidence reinforces the need to avoid transferring saved writes into repeated bound reconstruction, especially on Rust/APIs.

The remaining architectural question is whether line discovery and its consumers can share a traversal while preserving one explicit row/position ownership model and the incremental contract. The previous eager/lazy and current-row prototypes already tested several forms of that idea; a new proposal must identify a concrete removed traversal or changed consumer prerequisite before implementation. This report does not propose another wrapper, compressed layout or equivalent retry.

All raw observations, frozen bundle, profiling/probe scripts, CPU/JIT/GC logs, detailed per-row demand, build log and verification are preserved in `main-reference-973bd9c-node26-m1pro.json`. Production source and bundle are unchanged; only the consolidated records commit is amended. The 100× goal remains active.
