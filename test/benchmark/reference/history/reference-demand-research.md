# Definition availability versus actual dependencies

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Baseline: production source `a126216`, frozen bundle SHA-256 `a791d2624423e3c9d32aa60896480a31d78c7b1cf719a8ed010008d235fd79c9`. The inherited scanner/paragraph/heading changes were excluded and preserved. No source candidate from this investigation is admitted.

## Structural finding

`resolvePairedSyntax` queries `hasDefinitions()` whenever bracket frames exist, before knowing whether reference matching will occur. The incremental lookup tracker interprets a negative answer as a dependency on any future definition. A self-contained `[label](url)` consequently subscribes to a fact that cannot change its result.

The observed effect is a whole invalidation, not merely an extra lookup:

| First definition appended after 400 direct-resource paragraphs | Baseline | Demand variants |
| --- | ---: | ---: |
| Existing inline regions resolved again | 400 | 0 |
| Blocks constructed during the edit | 401 | 2 |

Actual `[ref]` paragraphs still invalidate. The old resource subscriptions disappear after their first resolution with definitions present, so this saving is specifically a first-definition event, not every repeated insertion. The timing guard includes **new document construction plus its first definition insertion**, rather than hiding construction outside timing.

## Implementations and adjustments

| Variant | Change | Bundle versus baseline |
| --- | --- | ---: |
| B | Query availability at each actual reference candidate | −61 bytes |
| C | Same demand boundary, with one invocation-local cached answer | −19 bytes |
| D | Extend the existing backward eligibility scan to find a raw `BracketClose`; query outside pairing | +106 bytes |

All preserve feature APIs, raw/resolved token ownership, definition keys, and incremental correspondence. D adds a private boolean parameter and extends the scan; it is not a new feature protocol. It nevertheless fails the bundle constraint.

The work counter explains why B and C are different: spec availability calls are 192 / 264 / 132 for A / B / C. API calls are 1,806 / 0 / 0. Repeated genuine reference edits perform the same logical resolution and rebuilding work in all versions. Moving a query later can remove false dependencies while still adding control-flow cost on genuine references.

## Strict comparisons

Node 26.13.0, Apple M1 Pro, `taskpolicy -c utility`, fresh process/module per observation, alternating ABBA/BAAB, 250 ms warmup, full GC, 150 ms settling, natural GC inside roughly 300 ms measurements. All 400 observations are retained; the maximum measured window is 299.335 ms. No own builds, checks or profiles overlapped throughput measurement.

Positive means slower. Confirmation aggregates use all block log ratios with the appropriate Student t interval; they do not discard the initial result.

| Comparison / case | Elapsed change | 95% CI |
| --- | ---: | ---: |
| A → B, spec: initial 8 blocks | +1.13% | +0.01% to +2.27% |
| A → B, spec: separate confirmation | −2.44% | −3.37% to −1.51% |
| A → B, spec: all 16 blocks | −0.67% | −1.84% to +0.51% |
| A → B, repeated definition availability | +1.97% | +0.44% to +3.53% |
| A → C, spec | −1.47% | −2.61% to −0.31% |
| A → C, Rust | −3.22% | −4.27% to −2.16% |
| A → C, API | +0.25% | −2.03% to +2.57% |
| A → C, ordinary tail edit | +0.28% | −1.19% to +1.77% |
| A → C, examples: all 16 blocks | +0.78% | −0.33% to +1.89% |
| A → C, document creation: all 12 blocks | −1.05% | −2.84% to +0.77% |
| A → C, new document + first definition | −33.13% | −33.46% to −32.79% |
| A → C, repeated definition availability: all 12 blocks | +1.96% | +0.99% to +2.94% |
| C → D, repeated definition availability | +1.14% | +0.26% to +2.02% |

B's initial spec result is **not** a stable-regression conclusion. C's initial examples and document-creation concerns also remain unresolved in the complete samples. Their confirmation history is retained in the JSON. By contrast, the repeated-reference edit regression is established for both B and C. D does not remedy it relative to C. There is no direct A/D throughput comparison and no compounded A/D percentage is inferred.

## Runtime evidence and uncertainty

V8 examples traces inline `hasDefinitions` in A, B and C. Their optimized pairing bodies are 9,112 / 9,296 / 9,224 bytes. None has a measurement-phase deoptimization in the inspected traces. These sizes do not explain throughput by themselves.

The actual repeated-definition edit workload was profiled separately with its tracked lookup, full feature configuration, edit phase reset, and identical warmup/GC/settling. A/C have no measured deoptimizations. Sampled GC is approximately 3.482 / 3.608 μs per edit; optimized pairing code is 6,880 / 6,872 bytes. The smaller C body still regresses. GC amplification, failed inlining, or machine-code growth is therefore not established as the cause.

The profiles are too coarse to isolate a roughly 2% difference to a particular instruction. Logical work counts establish the invalidation saving; direct comparisons establish the guard failure. B's independent guard and the C/D control rule out claiming that memoization alone, or simply moving the query outside pairing, explains and fixes the problem. No exact instruction-level attribution is claimed.

## Validation and disposition

B and C each pass the 194-test source suite, typecheck and lint. C additionally passes, in generated and forced-CSP modes, 2,614 corpus AST/position comparisons, 540 definition documents with 3,780 edits, and 4,608 broader feature edits. Definition edits compare the complete trees against both baseline and fresh parse. D passes generated/CSP corpus comparisons and the generated definition-edit matrix; it has no full admission claim. Public declaration files are byte-identical. No parser-private tests were added.

All three implementations are closed after attribution and adjustment; the dependency finding remains useful. Do not repeat these implementations unchanged. The next architectural question is whether dependencies can be expressed as actual positive/negative identifier lookups, removing availability-as-dependency altogether, without adding normalization or label-validation work. That question is not an implemented solution or an accepted speedup.

All bundles, patches, samples, CPU/GC/JIT logs, probes and validation artifacts are embedded with hashes in `reference-demand-research-a126216-node26-m1pro.json`. Production code and the three incoming worktree files remain unchanged. No new remark ratio is claimed; the 100× goal remains active and unmet.
