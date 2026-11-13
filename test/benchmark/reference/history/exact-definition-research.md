# Exact dependencies and shortcut-label facts

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Baseline: accepted production source `a126216`, frozen bundle SHA-256 `a791d2624423e3c9d32aa60896480a31d78c7b1cf719a8ed010008d235fd79c9`. Work stayed on `main` in the original worktree. The incoming scanner, paragraph and heading edits were excluded from comparisons and preserved byte-for-byte.

**No parser candidate from this investigation is admitted.** Candidate H remains unstaged in `packages/satorigear/src/profile/resolve.ts` for review and further attribution. The other implementations are archived, not present in production source.

## Model and implementation controls

| Variant | Change | Bundle delta |
| --- | --- | ---: |
| E | Remove `hasDefinitions`, the any-definition dependency sentinel and its invalidation branch; record only actual positive/negative identifier queries | −470 B |
| F | E plus a shortcut-label helper that returns the normalized identifier; count code points only beyond 999 UTF-16 units, initially with string iteration | −623 B |
| G | Isolate the F label helper on the original dependency model | −153 B |
| H | G with indexed `codePointAt` traversal instead of string iteration | −75 B |

E removes an entire dependency kind and its special handling, rather than relocating the availability query as in the previous experiment. It avoids re-resolving 400 resource-link paragraphs when the first definition appears; it also avoids re-resolving `[ref]` when the first definition is an unrelated `[other]`. But obtaining exact negative keys requires deriving labels that the old empty-table proof skipped.

On spec, E adds 263 normalizations over 4,114 UTF-16 units, 247 shortcut validations over 3,891 units, and 263 membership queries. Removing a real reference definition now performs 400 validations, normalizations and tracked string queries instead of recording the global sentinel. The model is more uniform, but its eager work is not free.

H retains the original dependency model. Its only source change is local to the grammar resolver: the helper returns `string | undefined` instead of a boolean followed by a second label scan. Short labels need no separate code-point counting. A nonempty normalized identifier proves content; an explicit Markdown-whitespace check preserves the Unicode-whitespace case that can normalize to an empty identifier. No feature API, token field, cache or ownership boundary changes. Net source change: 16 insertions, 25 deletions.

## Measured adjustments

Node 26.13.0 on Apple M1 Pro; every command used `taskpolicy -c utility`. Alternating ABBA/BAAB, fresh process/module per observation, natural GC inside measurement. All **496** ordinary observations are retained; the longest measurement was **299.437 ms**. No own builds, checks or profiles overlapped throughput.

Positive means slower. These are direct comparisons, not compounded percentages.

| Comparison | Case | Change | 95% CI |
| --- | --- | ---: | ---: |
| A → E | spec | +1.91% | +0.05% to +3.80% |
| A → E | repeated reference-definition edits | +10.02% | +6.40% to +13.76% |
| E → F | repeated reference-definition edits | −6.87% | −8.40% to −5.31% |
| A → F | repeated reference-definition edits | +4.26% | +0.83% to +7.80% |
| A → F | long ASCII labels, no definitions | +1324.42% | +1282.12% to +1368.01% |
| A → F | long Unicode labels, no definitions | +1386.52% | +1298.50% to +1480.08% |
| A → G | long ASCII labels, definitions present | +119.32% | +115.95% to +122.75% |
| A → G | long Unicode labels, definitions present | +12.32% | +11.21% to +13.44% |
| G → H | long ASCII labels, definitions present | −52.89% | −53.75% to −52.00% |
| G → H | long Unicode labels, definitions present | −11.08% | −12.21% to −9.93% |

The complete report also retains the weaker or contradictory stock-corpus comparisons. For H, the original-protocol initial and confirmation samples are pooled using all 12 block log ratios and the appropriate Student t interval:

| A → H | Change | 95% CI |
| --- | ---: | ---: |
| spec, all 12 blocks | +0.80% | −0.29% to +1.90% |
| examples, all 12 blocks | −0.21% | −1.72% to +1.33% |
| document creation, all 12 blocks | +1.80% | +1.06% to +2.55% |
| Rust, 4 blocks | −1.00% | −2.01% to +0.02% |
| API, 4 blocks | −1.67% | −3.24% to −0.09% |
| tail edits, 4 blocks | +0.48% | −2.10% to +3.13% |
| reference-definition edits, 4 blocks | −1.70% | −6.00% to +2.80% |
| long ASCII labels with definitions, 4 blocks | −1.05% | −3.39% to +1.34% |
| long Unicode labels with definitions, 4 blocks | −0.50% | −2.62% to +1.67% |

Crossing zero is not proof of equivalence. In particular, the API point estimate is not attributed to the helper when the workload does not execute it. H's document-creation guard remains unresolved for admission.

## Runtime attribution and measurement limits

E's reference-edit CPU samples show increased tracked string-query work. GC is approximately 3.733 / 3.761 μs per edit for A/E, so GC growth is not the established explanation. G's long-label slowdown appears in the label/resolver path; the helper is inlined, and the indexed-traversal control substantially reduces the cost. Short sampled self-time deltas are not an exact instruction-level decomposition.

For H's spec document-creation case, actual label-helper and normalization call counts are **zero in both variants**. The optimized pairing bodies are both 5,720 bytes. Neither that size equality nor coarse CPU samples explains the small regression.

A further phase audit exposed an important qualification: **no eager bailout lines does not mean JIT quiescence**. The explicit full GC can invalidate optimized `#updateTree` code because embedded weak objects were cleared. Dependent field-type invalidations follow during settling. With lightweight `--trace-opt --trace-deopt --trace-file-names`, both A and H still complete seven optimizations during the original measurement window.

Two bounded controls were tried:

- Four 250 ms warmup chunks before full GC do not prevent the post-GC invalidation; compilation still enters measurement.
- Four 250 ms settling chunks after full GC move the named `#updateTree` recompilation earlier, but three other optimization completions still enter measurement. The separate A/H document comparison is +0.59%, CI −1.42% to +2.64%.

The intervals overlap: this does **not** prove that longer settling removed the regression, identify the exact cause of the original difference, or establish a universal steady-state protocol. The longer-settling samples are not pooled with the original protocol. The production ABBA script has not been changed, and the old frozen remark reference cannot be reused for a changed protocol.

## Correctness and current disposition

E/F/H each pass 194 existing tests, typecheck and changed-file lint. Public differential checks cover generated and forced-CSP tokenizers, complete corpus AST/positions, 540 definition documents with 3,780 edits per backend, and 4,608 broader feature edits. F/H additionally cover 33 Unicode/whitespace/999-character boundary labels: 1,188 tree states and 792 edits per backend, checked against baseline and fresh parse. F's initial unused-loop-variable typecheck failure and its correction are retained in the archive. G is an isolation control, not a fully admitted candidate. No parser-private tests were added; public declarations are unchanged.

H is now an unstaged change on `main`, alongside the three untouched incoming edits. That combined working tree passes build, 194 tests, typecheck and changed-file lint. Its throughput has **not** been admitted: the isolated A/H measurements exclude the incoming edits.

- E/F are closed as implemented: removing the empty-table proof by eagerly normalizing negatives fails large and ordinary workload guards.
- G is superseded by H's measured traversal adjustment. Do not retry its string iteration unchanged.
- H remains a pending candidate, not an accepted optimization and not discarded solely on its first regression.
- Next measurement work must distinguish GC-induced recompilation and bounded warm-state comparisons without repeatedly sampling until favorable. Any protocol change needs its own validation and reference.

All source variants, patches, bundles, ordinary samples, work-count probes, CPU/GC/JIT logs and validations are embedded with hashes in `exact-definition-research-a126216-node26-m1pro.json`. Prepared scripts without a corresponding execution/report are not evidence of a completed experiment. The 100× remark goal remains active and unmet; no new remark ratio is claimed.
