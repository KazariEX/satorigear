# Fence descriptors and negative recognition paths

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Baseline: post-sync production source `a126216`, bundle SHA-256 `a791d2624423e3c9d32aa60896480a31d78c7b1cf719a8ed010008d235fd79c9`. The incoming paragraph/scanner/heading changes were excluded from comparisons and preserved byte-for-byte. No production candidate from this investigation is admitted.

The initial hypothesis was to represent the opening fence by its complete delimiter string, replacing the numeric marker and length. Closing recognition could compare that known prefix, then accept additional markers and trailing whitespace. All existing code/math/component consumers would share the same predicate. This retained per-line advancement: it did not replay the rejected whole-source fence searches or compiled regular expressions.

## Controlled results

Positive means slower. Every unprofiled observation used a fresh process/module, `taskpolicy -c utility`, 250 ms warmup, full GC, 150 ms settling, and a roughly 300 ms measurement including natural GC. Orders alternate ABBA/BAAB. There are 320 retained observations; the longest measured window is 299.104 ms.

| Comparison | Scenario | Elapsed change | 95% CI |
| --- | --- | ---: | --- |
| Original → string descriptor and prefix comparison | spec | +3.64% | +2.18% to +5.12% |
| Same string descriptor: prefix comparison → original comparison/control flow | spec | −2.97% | −4.39% to −1.53% |
| Original → source range, re-reading marker | spec | +0.41% | −1.32% to +2.16% |
| Original → source range, re-reading marker | examples | +1.63% | +0.07% to +3.21% |
| Original → numeric descriptor, unified validation/counting loop | spec | −0.13% | −1.69% to +1.45% |
| Same unified loop | examples, initial eight blocks | +1.12% | −0.77% to +3.05% |
| Same unified loop | examples, separate four-block guard | +2.92% | −1.40% to +7.43% |
| Same unified loop | fence-window edits | +3.08% | +1.08% to +5.13% |

Rust, APIs, ordinary tail edits, and document construction were also measured for the final control-flow candidate; their intervals crossed zero. They do not establish equivalence or rescue the fence-window regression. No result was discarded or retried to obtain a favorable sample.

## What the runtime evidence establishes

The string variant reduces source-receiver `charCodeAt` calls in the fence module from 53,807 to 33,088 per spec parse. That counter excludes marker-string reads and the comparison inside `startsWith`. It does **not** prove fewer underlying character comparisons.

Actual V8 object inspection shows a 56-byte original descriptor versus a 48-byte string descriptor plus a separate string. Short delimiters were sequential one-byte strings; long delimiters were sliced two-byte strings. This is shallow layout evidence, not a live-heap measurement or proof that string allocation caused the throughput regression.

In the traced spec workload, optimized `closesFence` grows from 7,904 to 9,312 bytes for the string/prefix candidate. Restoring the original comparison with the same string descriptor establishes a 2.97% improvement. This isolates the comparison/control-flow change from descriptor representation, but not a single native instruction or `startsWith` in isolation. GC diagnostics did not establish a large amplification, and inspected measurement phases had no deoptimization.

The source-range adjustment keeps `offset` and `length`, removes the stored marker, and re-reads it from source. It adds exactly 4,876 source-character reads per spec parse, one per close-predicate call. Its bundle also grows by 15 bytes. This fails admission despite using one fewer persistent field.

The final control-flow candidate restores the numeric descriptor and uses one marker loop for validation and counting. It removes 6 net source lines and 130 bundle bytes. Its spec machine code shrinks to 7,192 bytes, but the actual edit workload emits 4,504 bytes versus the original's 4,416 bytes. Machine-code size is workload-specific.

The edit probe explains a concrete additional path: both variants make 2,324 close calls during the recorded fence insertion, including actual incremental rescans. The original reaches marker-length validation **zero** times; the simplified version reaches it **1,157** times. It removed the early rejection of indented non-marker content. Both traced edit measurements had zero deoptimizations. This is evidence of added execution, not merely an adverse timing sample.

## Better phase attribution for subsequent architecture work

The CPU profiler requested 100 μs intervals, but observed sample deltas had a median near 884 μs, close to a complete spec parse. Periodic sampling aliasing is possible, not proven. Short profile shares must not be treated as an exact additive cost model.

A separate probe uses only five clock reads per parse to time whole phases. Baseline averages were approximately:

| Phase | Instrumented wall time per parse |
| --- | ---: |
| Physical line construction | 211 μs |
| Remaining block scan | 247 μs |
| AST/inline construction | 482 μs |

A second diagnostic samples one in sixteen inline regions, rotating selection across parses. It estimates tokenize around 210 μs and resolve around 72 μs. These estimates include timer/wrapper overhead, finite-sample imbalance and possible GC correlation. They identify work worth investigating; they are neither uninstrumented admission results nor exact causal percentages. The ASTs from instrumented and original parsers were compared before measurement.

## Disposition

The representation and control-flow variants are closed after runtime-guided adjustments and separate comparisons. All source remained experimental; the incoming worktree files and matching dist were restored. Source/CSP tests both passed 194 cases for the final candidate, along with syntax, position, component, and independent edit-feature matrices. No parser-private tests were added.

Do not repeat string descriptors/prefix comparison, marker re-derivation, or removal of the indentation early rejection without a new consumer or lifetime invariant. The next architectural candidate must remove complete work or representations, while retaining useful negative proofs and facts that are repeatedly consumed.

Raw observations, frozen bundles, all source variants, unsuccessful drafts, V8 profiles/disassembly/layout logs, probes and validation artifacts are recoverable from `fence-descriptor-research-a126216-node26-m1pro.json`. No new remark ratio is claimed; the 100× goal remains unmet.
