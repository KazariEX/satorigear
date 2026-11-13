# Shortcut caller control-flow attribution

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

The pending H candidate merges shortcut-label validation and normalization. I moves the definition lookup into that predicate and restores the original success-only caller branch. The label algorithm, ownership, token layout and feature API remain unchanged. I is two source lines smaller than the accepted parser and its production bundle is 94 B smaller; it is not admitted.

All throughput comparisons used Node 26.13.0 on M1 Pro, `taskpolicy -c utility`, fresh workers/modules, alternating ABBA/BAAB, 250 ms warmup, explicit GC, 150 ms settling and approximately 300 ms measurement (500 ms cap). Natural GC and every observation were retained. Builds, tests and profiles did not overlap throughput. These are not M3 measurements.

| Comparison | Blocks | Spec elapsed change (95% CI) | Document/spec elapsed change (95% CI) |
| --- | ---: | --- | --- |
| Pending H → I | 4 | +2.034% [+0.740%, +3.344%] | −0.700% [−3.666%, +2.357%] |
| Accepted A → I | 4 | +1.302% [−2.201%, +4.930%] | −2.206% [−3.867%, −0.516%] |
| Accepted A → I confirmation | 8 | +1.811% [+0.556%, +3.082%] | −0.291% [−1.705%, +1.143%] |

The confirmation establishes a spec regression. The initially favorable document result does not establish a repeatable improvement. The caller-shape hypothesis is therefore not supported.

## Runtime evidence and limits

- In document/spec, both A and I execute zero shortcut validator, label normalization and definition membership calls. This helper does not reduce work in that corpus.
- A/H/I each produce 5,720 B of optimized `resolvePairedSyntax` code in the document diagnostic. After normalizing addresses and six declared address-synthesis instructions, all 1,406 printed instruction lines match. This is evidence about one optimized function, not whole-process timing equivalence.
- Spec diagnostics produce 5,408 B for that function in both A and I. Instruction identity was not established for spec.
- Document JIT logs show post-GC dependent-code invalidation in all three variants and seven or eight optimization completions during measurement. Concurrent trace lines can interleave; raw logs are preserved. These observations do not establish the cause of the regression.
- Sixteen short spec CPU profiles preserve ABBA/BAAB ordering. GC time per parse is 25.912 μs for A and 24.149 μs for I, so they do not support GC amplification. Self-time changes are spread across unchanged functions; inspector bookkeeping is also visible. These diagnostic timings are not throughput results or an exact causal decomposition.

## Validation and disposition

Production A/H bundle hashes match their historical frozen binaries. Initial programmatic builds retained extra comments; they were not benchmarked, and are archived separately. All correctness checks were repeated on the normal production builds.

Generated and forced-CSP paths each pass 2,614 complete AST/position comparisons; 33 label forms with 1,188 tree states and 792 edits; 540 definition documents with 3,780 edits; and 4,608 feature edits. No parser-private tests were added. No new unit-suite/typecheck result is claimed for I.

I was restored to the incoming H source, with all four incoming modified files and the working bundle verified byte-for-byte. H remains pending and has no admission claim. Do not repeat this boolean-caller variant unchanged. The exact cause of H's earlier document regression remains unresolved; a smaller helper or identical optimized code for one function is insufficient to declare it harmless.

The historical current-row audit also confirms that its early approximately 4% benefit was a research-to-research comparison. Its later comparison against production regressed, so no current-row variant was reimplemented. Numeric delimiter replacements and eager trailing-whitespace count maintenance were recognized as historical routes before implementation.

Full reports, all 128 throughput observations, 16 CPU profiles, five JIT logs, frozen bundles, source snapshots, scripts and validation outputs are retained in `shortcut-control-research-a126216-node26-m1pro.json`. The 100× remark goal remains unmet; no multiplier was updated.
