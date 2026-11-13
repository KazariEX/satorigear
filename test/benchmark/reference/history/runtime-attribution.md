# Three-field line storage: runtime attribution

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

This investigation addresses the premature rejection of a promising representation after a throughput regression. Its frozen baseline is **fed4f91**, before the sync onto **61349a8**. None of its timings measure the current source after that sync.

The candidate removed stored `End` coordinates, encoding line-ending width in state and deriving `End` from `Next`. Consumers initially switched to `Next` bounds. Fewer stored fields and fewer `End` queries did not imply less execution: the consumers introduced additional source-character reads.

## Observed work and adjustments

- Character probes found 7,425 additional `source.charCodeAt` executions per spec parse in four block modules after the first adjustment. This excludes other receiver names, native string search, and regular expressions.
- V8 emitted 6,248 bytes for the three-field candidate's `scanBlockLines`, versus 4,744 for baseline. Bounds-exit sites increased from eight to ten, associated with additional root/blank-line character call sites.
- Combining the root character call and using a dedicated blank-line loop reduced this to 4,856 bytes and eight exits. The throughput control did **not** establish a benefit.
- Representing the locator cursor as a line ordinal removed the packed-field division by three. `locationAt` machine code shrank from 1,624 to 1,372 bytes. Again, the throughput control did **not** establish a benefit.
- Restoring the original End-bound consumers eliminated all 7,425 additional character reads while keeping three-field storage and the ordinal cursor. The result still regressed against the original baseline.

Inspected trace runs did not show settling/measurement deoptimization; `end` still inlined into consumers. GC measurements did not show a large amplification. These observations rule out simplistic explanations; they do not explain every percentage point. CPU samples shift with inlining, and profiler start/stop overhead is not parser work. Sampled subsystem totals are not an additive causal decomposition.

## Unprofiled throughput controls

Positive values mean slower. Each control uses alternating ABBA/BAAB, a fresh process/module per observation, 250 ms warmup, full GC, 150 ms settling, and approximately 300 ms measured windows capped at 500 ms. Natural GC remains inside timing. All commands use `taskpolicy -c utility`.

| Control | Spec elapsed change | 95% CI |
| --- | ---: | ---: |
| C → D: consolidate character call sites | +0.84% | −2.83% to +4.64% |
| D → E: ordinal locator cursor | +0.24% | −1.33% to +1.84% |
| E → F: restore original consumer bounds | −0.90% | −2.04% to +0.26% |
| Original A → F | **+1.91%** | **+0.56% to +3.26%** |
| F → padded stride-four P | +0.43% | −0.59% to +1.46% |
| P → stored-End H | −0.35% | −1.65% to +0.96% |

The last two are diagnostic controls, not optimization proposals. Padding changes both addressing and footprint. Storing End changes both read cost and write cost. Neither control isolates a single CPU instruction, and neither establishes the cause of the remaining regression. F also adds approximately 40 bundle bytes.

## Disposition and reopening condition

No production candidate from this route is admitted. This conclusion follows runtime-guided adjustments and controlled interventions, not the first adverse ABBA result. The original consumer-only and packing measurements remain valid historical evidence.

Do not repeat packing, padding, or field-order tuning without a material change to the consumer or lifetime contract. The useful next question is whether a whole repeated decision or traversal can be removed, rather than replacing stored facts with repeated derivation. Reopen this route if a new dataflow changes which bounds are actually consumed.

The adjacent `runtime-attribution-fed4f91-node26-m1pro.json` contains 224 unprofiled observations, 48 CPU profiles, JIT/GC logs, character probes, frozen bundles, source snapshots, correctness results, and recovery hashes. The reference-to-remark estimate is unchanged and remains historical; the 100× goal is not achieved.
