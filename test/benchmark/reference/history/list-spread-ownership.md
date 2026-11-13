# List-item spread ownership

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Status: historical Q-only experiment. Follow-up validation on accepted Q+D is complete and did not admit either item-only form; see `list-spread-ownership-main.md`. The broader C extension remains withdrawn. `main` matches accepted `69240f6` source, including borrowed scan ranges. Do not restore the known regressing Q review version as the development base.

## Model and scope

The generic nested scanner currently computes blank separation between direct blocks for every container, although only list items consume that result. B derives `listItem.spread` in the list builder from the positions of its already-built direct children. An exclusive end at column 1 belongs to the preceding physical line. A following child starting more than one line later establishes separation.

This removes the nested-scan callback, trailing blank-line rescans and `ListItemSpreadClose`. Ordinary explicit `ListItemClose` remains; no implicit closure, metadata field or feature API is introduced. Production changes are confined to `block/scanner.ts`, `constants/block.ts` and `profile/features/list.ts`. B's two public tests cover nested fenced-code syntax and an equal-length edit that changes blank separation.

C additionally derives `list.spread` from item positions and removes `ListSpreadClose` plus the list scanner's spread state. That scan already traverses item boundaries; repeating their interpretation in the AST builder adds work. C is not retained.

## Performance

All comparisons below use exact Q as A, **not accepted Q+D**. Q is 160,358 B; B is 160,238 B (−120); C is 159,997 B (−361). Build/minification settings are unchanged and public declarations match. These measurements cannot establish combined Q+D+B performance.

Node 26.13.0, Apple M1 Pro, `taskpolicy -c utility`; alternating ABBA/BAAB, fresh processes/module caches, 250 ms warmup, full GC, 150 ms settling and approximately 300 ms measurement including natural GC. Every phase is bounded at 500 ms. Own builds/tests/profiles do not overlap throughput. All batches are retained.

| Q → B, 12 blocks | Time change | 95% interval |
| --- | ---: | --- |
| Spec | −1.53% | [−2.71%, −0.34%] |
| Examples | +0.27% | [−0.76%, +1.32%] |
| Rust | −3.59% | [−4.45%, −2.71%] |
| APIs | −0.82% | [−4.24%, +2.72%] |

| Q → B, 4-block guards | Time change | 95% interval |
| --- | ---: | --- |
| Document/spec | −0.53% | [−4.09%, +3.16%] |
| Tail edit | −0.89% | [−3.82%, +2.14%] |
| List blank-line edit | −8.65% | [−11.04%, −6.21%] |
| Wide list | −5.34% | [−6.07%, −4.61%] |
| Multiple blocks per item | −2.45% | [−4.38%, −0.48%] |
| Nested quote headings | −2.23% | [−3.80%, −0.64%] |

C's pooled 12-block spec result is **+1.14% [ +0.18%, +2.12% ]**. Its examples/Rust/API intervals cross zero. C was profiled and narrowed back to item-only B rather than being rejected without investigation. No direct B/C throughput comparison was run; subtracting separate Q comparisons would not establish causality. Cross-zero intervals do not prove non-regression.

## Runtime attribution

Untimed execution counters, with equal complete corpus ASTs:

| Rust work per parse | Q | B | C |
| --- | ---: | ---: | ---: |
| Nested direct-block visitor calls | 6,334 | 0 | 0 |
| Blank-line checks | 6,906 | 488 | 488 |
| New adjacent AST-span comparisons | 0 | 142 | 5,363 |

On spec, B removes 143 visitor calls and reduces blank checks 162 → 14, adding 21 span comparisons. C adds 53. These are executed-work counts, not allocation bytes or exact time accounting of C's regression.

CPU summaries now intersect each sample interval with the actual measured `hrtime` window, after verifying its alignment with CPU-profile timestamps. Inspector startup `post` samples are excluded. Earlier startup-inclusive totals do not affect uninstrumented ABBA results. Effective sample cadence is roughly 495 μs despite requesting 100 μs. B's profiled spec GC observations are 22.82 → 19.41 μs/parse, but unchanged hot paths also vary; samples are not additive throughput attribution. JIT optimization still occurs during measurement.

## Correctness and next step

B passes 198 public tests, typecheck, generated/CSP corpus checks and 4,608 feature edits per backend. Expanded checks cover 11,720 documents and 26,520 edits per backend, including 5,700 actual equal-length edits. They find three unique inherited list-item spread errors corrected by B/C. All other AST fields match the baseline, and type/children/spread match the canonical parser. An inherited fenced-code body whitespace mismatch remains: **full canonical AST equality is not claimed**. The first test incorrectly expected that unrelated body mismatch fixed; its failure and subsequent correction are retained. An initial equal-length probe actually performed zero such edits; its expanded replacement supplies the coverage quoted above.

That main-base admission step has now been performed and is recorded in `list-spread-ownership-main.md`. Q-only gains do not authorize a source commit on a different base. C's unchanged all-list derivation should not be retried without evidence that its extra traversal or optimization boundary has changed.

Full observations, failed attempts, source/build snapshots, diagnostic scripts, CPU/JIT logs and hashes are retained in `list-spread-ownership-node26-m1pro.json`. No new remark ratio or M3 result is claimed; the 100× goal remains unmet.
