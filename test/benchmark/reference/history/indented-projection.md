# Indented code: qualification versus body materialization

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

The fused candidate is withdrawn. It reduces normal indented-code parsing by about 17%, but regresses a long trailing-empty-line guard by 55%. Production is restored to accepted source `2c1b10c`, records base `ecb0a31`, and the exact 161,093 B bundle with SHA-256 `647a800e21901ec1455291689ca40e330115d43ddb15946efffc118d2e759f64`. No new remark ratio or M3 result is claimed; the 100× goal remains unmet.

## Candidate and retained contracts

Only `packages/satorigear/src/profile/features/code.ts` changes: 26 additions / 29 deletions. The candidate bundle is **161,009 B**, 84 B smaller, with unchanged minification settings.

The original path first determines which rows belong to the indented block, then excludes trailing blank rows, and finally consumes structural indentation while materializing the retained body. The candidate merges qualification and indentation removal into one loop. It accepts a row when four columns have been consumed or the row is blank, immediately appends its projected body, then applies the original trailing-blank test and shortens the parts array before joining it. The independent `indentedContent` helper disappears.

Token kind, span, metadata, consumed line range, code/math behavior, raw/resolved inline ownership, feature registrations and incremental correspondence are unchanged. There is no new persistent field, cache, feature API, packed layout or ownership protocol. The model cost is earlier materialization: rows whose inclusion in the final value is not yet established now enter the temporary body-parts array.

## Actual work, including the unfavorable cases

Frozen-bundle probes run public parses and compare complete AST/positions against the uninstrumented baseline. Both backends agree on all counters across 1,320 instrumented parses per backend, covering stock corpora and the five guards below. Counts are executed loop visits and array appends, not machine instructions or allocation bytes.

| Input | Old qualification visits | Old body visits | New fused visits | Body-parts appends A → B | New discarded parts |
| --- | ---: | ---: | ---: | ---: | ---: |
| spec | 8 | 4 | 11 | 4 → 8 | 4 |
| examples | 62 | 85 | 115 | 85 → 98 | 13 |
| 1,600 ordinary code rows | 1,599 | 1,600 | 1,600 | 1,600 → 1,600 | 0 |
| interior blank rows | 1,599 | 1,599 | 1,600 | 1,599 → 1,600 | 1 |
| 1,600 trailing empty rows | 1,601 | 1 | 1,602 | 1 → 1,601 | 1,600 |
| 800 trailing 64-space rows | 801 | 1 | 802 | 1 → 801 | 800 |
| projected code | 2,399 | 2,400 | 2,400 | 2,400 → 2,400 | 0 |

Qualification/fused counts include the terminating probe when present. The parts counters count append operations; an empty string may be reused rather than allocated anew. The long-space tail appends and discards 48,000 logical code units, not necessarily 96,000 allocated bytes.

Spec has only three indented blocks and four retained body rows. Rust/APIs execute this path zero times. This candidate therefore cannot plausibly remove substantial spec work; a small stock timing movement must not be attributed to thousands of nonexistent body-loop iterations. It was examined as a possible simpler consumption path with useful affected-workload gains, not as a claim that it achieves 100× by itself.

## Strict throughput

Node **26.13.0**, selected by absolute executable path, Apple M1 Pro. Every build/test/probe/benchmark command uses `taskpolicy -c utility`. Each observation has a fresh process/module, 250 ms warmup, full GC, 150 ms settling and approximately 300 ms measured including natural GC. The phase cap is 500 ms. Own builds, tests and profiles do not overlap throughput.

All seven cases use four alternating ABBA/BAAB blocks. All **112** observations are retained; longest measured window **299.1715 ms**. Positive means slower; intervals use paired block log ratios and Student t.

| Workload | Change | 95% interval |
| --- | ---: | --- |
| spec | +0.06% | −0.53% to +0.65% |
| examples | +0.77% | −0.25% to +1.81% |
| ordinary indented code | −17.11% | −20.33% to −13.75% |
| code with interior blank rows | −13.21% | −13.79% to −12.63% |
| code followed by empty rows | **+55.19%** | **+55.07% to +55.31%** |
| code followed by space-only rows | **+8.12%** | **+7.40% to +8.85%** |
| projected indented code | −12.19% | −13.34% to −11.03% |

Spec/examples crossing zero do not establish exact equivalence. No broad incremental throughput or CSP throughput admission is claimed. The established tail regressions already disqualify the source; no additional stock measurements are used to try to outweigh them.

## Runtime attribution before withdrawal

Separate four-block ABBA/BAAB CPU groups inspect ordinary code and the empty-tail guard. Source-file/line positions distinguish the indented `start` handler from unrelated methods named `start`.

- On ordinary code, A has approximately 53.32 μs/operation of `indentedContent` self samples, 20.46 μs in `lineIndentOffset`, and 6.21 μs in the indented start handler. B's fused handler has about 54.40 μs. This is consistent with eliminating repeated indentation qualification over retained rows; these samples are not an additive wall-time decomposition.
- On the empty-tail guard, the indented handler's self samples rise **2.83 → 19.23 μs/operation**. Physical `BlockLines.#scan` remains around **20.94 → 21.04 μs**. Together with the executed append counts, this localizes substantial extra work to early body construction rather than a new physical index.
- Observed GC per operation on that guard rises **0.045 → 0.527 μs**. GC contributes, but cannot by itself explain the roughly 18.49 μs difference between those separate profiled elapsed means. Natural GC remains included in the normal throughput measurements.
- The phase-tagged JIT traces have no measurement bailout or dependent-code invalidation. They still complete optimizations during measurement: ordinary A/B 2/3, tail A/B 8/7. No globally quiescent JIT state is claimed. One diagnostic tail trace has 4/66 scavenges; totals are not per-operation cost estimates.

The normal-code profiled elapsed ratio differs from the unprofiled estimate. It is not substituted for the admission result. All raw profiles, logs, clock coverage audits and ±100 μs clipping-boundary sensitivity remain available.

## Why the phase boundary remains

The first scan is doing more than redundant indentation work: it supplies a negative proof that excludes terminal blank rows from materialization. Fusion saves work when consumed rows are retained, but creates work when consumed coverage is larger than the semantic body.

Possible repairs were considered but not implemented or benchmarked. Deferring blank rows would require lookahead plus a pending source range and later projection, or storing stripped offsets/body fragments until retention is known. An offsets cache introduces another intermediate representation; assigning numeric and string meanings to the same parts array makes that representation implicit. Restoring complete range qualification restores the existing phase boundary. None is presented as a proven faster or simpler solution. The candidate is withdrawn on measured regressions and an understood work expansion, not on missing a minimum-gain threshold.

Reopen only with a concrete design that preserves the retained-body proof without eagerly materializing discarded rows or adding a second row model. Do not repeat this same fused loop, or retime only ordinary code while omitting trailing-whitespace guards.

## Validation and other screened routes

Build, typecheck and all 198 existing tests pass. Generated and forced-CSP validators each pass 2,614 corpus AST/position comparisons, 4,608 feature edits, 612 definition-related documents / 4,284 edits, earlier syntax/delimiter guards, and a new cache-only indented-code matrix of **3,072 documents / 6,144 edits**. The latter compares full trees to baseline and candidate fresh parsing. It includes spaces/tabs, LF/CR/CRLF/mixed endings, container prefixes and interior/trailing blank forms. It does not canonize inherited projected-tab behavior as normative CommonMark. No parser-private repository tests are added.

Before implementing this candidate, two older directions were screened rather than rerun:

- The demand on physical `End` has not changed enough to reopen the compressed/lazy line-layout experiments; [the existing work-count screen](line-demand-after-literal.md) still applies.
- AST builder codegen already exists as historical **candidate 79** in `progress-node26-m1pro.json`. That prototype added a grouped direct-call switch without established benefit and changed the caller's inlining boundary. A current Node 26 feedback probe finds `Call GENERIC` at `buildBlockNode` slot 12 and `buildBlockChildren` slot 24, while `buildBlockNode` still inlines into `parse`. Megamorphic feedback alone is therefore not a changed premise. No new AST codegen source or throughput comparison was made. The probe appends diagnostic exports to the frozen bundle without changing function bodies; it is not a production timing artifact. The cached route index contains historical dispositions, not a claim that every historically retained source is present now.

Production source and the rebuilt bundle are byte-identical to the starting baseline. Only the consolidated records commit is amended; no source/revert commit, worktree or push is created. Full bundles, the one-file patch and source snapshots, observations, validation, counters, CPU/JIT/GC data and the preflight feedback/index are archived with hashes in `indented-projection-ecb0a31-node26-m1pro.json`.
