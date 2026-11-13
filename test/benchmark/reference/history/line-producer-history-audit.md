# Line producer control and historical route audit

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

**No source change is retained.** Production source and rebuilt bundle are restored byte-for-byte to accepted source `7692fbb`, bundle **160,838 B**, SHA-256 `cb48a7a3f3bf1cd62b4c3ab009dede544560c3776c77a017105a4c28f8b33107`. This turn does not establish a spec gain or a new remark ratio. The 100× objective remains unmet.

## Runtime observation and premature experiment

A fresh phase-tagged Node 26.13.0 / Apple M1 Pro diagnostic prints the optimized physical `BlockLines.#scan` code from this exact bundle. The final non-OSR body is 820 bytes. Its four row stores still have four adjacent `cmp`/`b.hs` bounds guards and checked field-index arithmetic. This is generated-code evidence, not proof that those checks dominate elapsed time or can be removed by a source rewrite. The warmup OSR body is a separate 912-byte compilation and must not be confused with the final body.

Candidate B replaces four post-increment stores with fixed `BlockLineField` offsets and one stride advance. All stored fields, LF/CR discovery, normalization, ownership, capacities and consumers remain unchanged. It grows the bundle **23 B**. It passes build/typecheck, all 198 existing tests and the twelve generated/CSP public differential jobs. No new parser-private tests are added.

The two-case diagnostic comparison completed before the history error was identified:

| B versus A | Elapsed change | 95% CI |
| --- | ---: | --- |
| spec | −0.54% | [−1.76%, +0.68%] |
| examples | −0.70% | [−2.76%, +1.39%] |

Neither interval establishes a gain. All 32 observations are preserved. They use `taskpolicy -c utility`, absolute Node 26.13.0, fresh process/module, alternating ABBA/BAAB, 250 ms warmup, full GC, 150 ms settling, natural GC and roughly 300 ms measured phases capped at 500 ms. A short read-only JSON history-extraction script ran while the comparison was active. Consequently these timings are **diagnostic only, not an uncontended admission run**. No confirmation or additional timing was run after identifying the historical duplication.

## History-audit correction

The initial screen read the standalone Markdown studies but missed a structured record in `progress-node26-m1pro.json`. Historical **candidate 60** already tested fixed-offset row writes and one stride advance, with an additional full-row capacity proof. Its optimized code retained all four bounds guards and grew from 812 to 820 bytes. Historical **candidate 80** tested the related capacity-bounded inner producer loop; it also retained all four guards and grew to 968 bytes.

This turn's source variation omits candidate 60's extra capacity predicate, but there is **no changed consumer or runtime premise supporting reopening that mechanism**. The new baseline disassembly still showing bounds checks is not such a premise. This control should have been excluded before implementation and timing. Its source and all results are archived, then removed; the small negative timing estimates are not grounds to retain it.

The audit also found ordinary numeric line arrays (27), split-based line production (75), separate LF-only/mixed loops (41), sparse line discovery plus native fence search (43), and single-character physical scanning in `physical-index-research-89ce055-node26-m1pro.json`. They were not implemented again here. The character-loop result was +14.68% spec in that earlier record; it is historical, not a current measurement.

The preceding delimiter experiment needs the same qualification: historical candidate 20 and the work-count screen in `inline-recognition-research.md` already warned that eager lexical flanking adds work inside opaque syntax and cannot prune any of spec's 206 eligible runs. Its B/C exploration was not a wholly new architectural premise. The final accepted formatting-local declaration simplification is separate from that rejected movement of classification.

## Searchable evidence and next-action constraint

`research-route-index.md` exposes **73 structured route records** with their original JSON paths, descriptions, historical outcomes and links. It also links later focused reports. It is a navigation aid, not a claim of exhaustive semantic deduplication. Historical “kept” statuses are explicitly not current admission statuses; later withdrawals and upstream changes still govern.

Future proposals must be screened against both this index and the standalone reports before implementation. Reopening a failed route requires a concrete changed prerequisite and must address its prior counterexample. Neither repeated profiling of a hot function nor favorable noise is sufficient. This correction changes the research process; it does not substitute documentation for the unmet performance objective.

All frozen A/B bundles, source patch, validation, raw comparison observations, baseline V8 disassembly/phase logs, history-screen output, route records and restoration build are in `line-producer-03421a3-node26-m1pro.json`. Only the single consolidated records commit is amended. No optimization commit, worktree switch, revert or push occurs.
