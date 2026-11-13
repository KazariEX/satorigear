# Bracket frames with stable named facts

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Retained source commit: `9a9b552` — `refactor: represent bracket frames with named fields`.

Only `packages/satorigear/src/profile/resolve.ts` changes. The bundle decreases from 161,643 to 161,599 B (44 B), without a minification change. The final bundle SHA-256 is `e75e4f045fbe747e02afa94e762fdd8d2e0dd334120d48642c7e8f5f5bab1df9`; baseline `76cebfc` uses `c98a3b1976e99d0d26cf3b64557fa8f6292b17c1ce28198bda2682508e9d2d38`.

The change is retained for explicit field meanings, direct frame relationships, and measured improvements on bracket-heavy syntax, with no established regression in the tested guards. **Spec has no established speedup in the combined result. Crossing-zero intervals do not prove exact equivalence or universal non-regression.** No new remark comparison was made; the old reference ratio must not be transferred to the new bundle. The 100× goal remains unmet.

## Model change

The old representation stores six numeric slots per raw bracket opener. `WorkspaceA` means candidate-bottom during analysis, delimiter checkpoint during pairing, and resolved source end after a link matches. `WorkspaceB` means candidate link, logical parent, then emission parent. Every reader must know the phase and whether the slot was already overwritten.

The new representation uses one ten-field record per opener. Each fact has a stable name and meaning; frame links are direct references rather than offsets into the numeric arena.

| Meaning | Old representation | New field |
| --- | --- | --- |
| Opening/closing token | numeric slots | `open`, `close` |
| Raw nesting parent | frame offset | `parent` |
| Claim and flags | numeric slot | `state` |
| Feature-candidate boundary/link | workspace A/B | `candidateBottom`, `candidateNext` |
| Delimiter checkpoint | workspace A | `delimiterStart` |
| Resolved resource/reference end | workspace A | `resolvedEnd` |
| Logical link parent | workspace B | `logicalParent` |
| Emitted reference parent | workspace B | `referenceParent` |

This removes a phase-dependent storage protocol, **not** a parsing pass or semantic fact. Analysis, pairing and emission remain the same three stages. Tokens, feature APIs, feature precedence, definition lookup/dependencies, raw-stream retention, and incremental correspondence remain unchanged. No grammar-specific alternate resolver is added.

History review included the rejected ordinary-bracket traversal-fusion experiment in `architecture-attribution-4a9c16d-node26-m1pro.json` and frame-workspace rechecks. The former introduced preanalyzed versus pending-frame paths without a stable benefit. This experiment does not retry that fork or rely on an assumption that all bracket claims are known at the opener.

The representation does use more explicit per-frame storage. It is not advertised as allocation elimination or a reduction in the number of facts.

## Measurements

Node 26.13.0 / Apple M1 Pro; every test/build/profile/benchmark command uses `taskpolicy -c utility`. Fresh process/module per observation, alternating ABBA/BAAB, 250 ms warmup, full GC, 150 ms settling, approximately 300 ms measured with natural GC included. The harness caps each phase at 500 ms. No own tests/builds/profiles overlapped throughput. All 256 unprofiled observations remain archived; maximum measurement was 299.335 ms.

Positive is slower. Spec, Rust and tail combine all initial four and independent eight blocks using paired log ratios and Student t(11); other rows have four blocks.

| Workload | Blocks | Change | 95% interval |
| --- | ---: | ---: | --- |
| spec | 12 | −0.36% | −0.73% to +0.02% |
| examples | 4 | −0.10% | −0.92% to +0.72% |
| Rust | 12 | −0.40% | −0.86% to +0.06% |
| APIs | 4 | −1.49% | −3.05% to +0.09% |
| document/spec | 4 | −0.34% | −1.25% to +0.59% |
| tail edit | 12 | +0.44% | −0.84% to +1.73% |
| 1,600 unmatched opening brackets | 4 | −14.87% | −15.67% to −14.07% |
| 400 nested-link groups | 4 | −3.18% | −3.56% to −2.80% |
| 300 component-label groups | 4 | −1.97% | −3.12% to −0.80% |
| repeated definition availability edits | 4 | −0.94% | −2.34% to +0.48% |

The first Rust batch was −1.03% with an interval below zero; the independent batch was −0.09% crossing zero. The first tail batch was +1.61%, CI [−1.94%, +5.28%]; independent confirmation was −0.15%, CI [−1.60%, +1.33%]. Neither contrary batch is discarded. Independent spec confirmation alone was −0.52% with an interval just below zero, but the combined interval crosses zero.

The custom reference-edit runner uses the previously corrected paired-settling condition. Every recorded settling count is even; the invalid odd-phase historical reference measurements were not reused. Synthetic sources and profiles are frozen in the runner and separately checked through public parse/document/edit APIs.

## Runtime evidence and attribution limits

Generated/CSP work-count probes agree and preserve complete public AST/positions:

| Input | Resolving regions, both | Bracket frames, both |
| --- | ---: | ---: |
| spec | 222 | 379 |
| Rust | 5,379 | 7,726 |
| APIs | 1,806 | 1,806 |
| unmatched bracket guard | 1 | 1,600 |
| nested-link guard | 1 | 800 |
| component guard | 1 | 900 |

Thus the improvement is not fewer frame recognitions or token passes. Tail append resolves one formatting region with zero bracket frames; removal resolves no region. The changed resolver still executes on append, so zero frame allocation must not be called zero changed-code execution.

V8 `%DebugPrint` shows the old frame arena as a numeric elements array and the new frame as a 104 B `JS_OBJECT_TYPE`, ten in-object properties, FastProperties and no out-of-object property array. Four mixed link/image/component frames share the same map in both backend diagnostics. This describes that observed cohort, not every possible runtime state. Instrumentation retains frames, so these layouts are not exact total allocation/retained-heap measurements.

Natural GC is included in the throughput numbers. The unmatched guard's mean observed GC is approximately 1.883 → 1.851 μs/parse; nested groups 9.925 → 9.695; components 15.052 → 15.004. Extra explicit object storage did not produce a measured GC penalty in these guards. This does not prove lower allocation volume.

Separate four-block CPU diagnostics reproduce the unmatched direction (about 83.24 → 71.08 μs/parse), with observed GC about 1.66 → 1.65 μs/parse. Sample attribution moves among the resolver and its callees. In particular, the anonymous resolver closure is approximately 14.42 → 1.94 μs self time, while named `analyzeBrackets` increases about 4.30 → 6.32 μs. The closure was identified by bundle URL and source line; it is not the generated tokenizer. These sampled movements must not be reported as an exact number of removed bounds checks or allocation instructions. No parsing-stage elimination occurred.

Tail CPU diagnostics do not reproduce the adverse first throughput direction (about 49.62 → 49.46 μs/edit); GC is about 0.925 → 0.945 μs/edit. JIT logs show optimization completions during measurement in both variants and no measurement-phase bailout/invalidation in these inspected logs. They do not prove JIT quiescence. The tail investigation and independent confirmation provide no supported instruction-level regression cause, so no speculative workaround was added.

## Validation and history

- All 196 existing tests pass; no parser-private repository tests were added.
- Typecheck, changed-file lint and whitespace checks pass.
- Each backend passes 2,614 full corpus AST/position comparisons, 612 definition-related documents with 4,284 edits against baseline and fresh parse, and 4,608 feature edits against fresh parse.
- Each backend also checks all four custom performance sources under three feature configurations: 12 documents and 24 edits, full AST/positions against baseline and fresh parse.
- Actual six-feature Rust/APIs parse results are additionally compared to baseline by the work-count probes.
- Final build is byte-identical to the measured candidate. Final source-only cleanup changes one comment and removes a redundant TypeScript assertion; it does not change emitted JavaScript.

The source commit uses KazariAI identity and a title only. It is placed before the single trailing consolidated record commit; no revert commit or extra worktree is introduced. Full variants, source patch, scripts, timings, CPU profiles, JIT logs, V8 layout logs and validation outputs are embedded in `named-bracket-frames-76cebfc-node26-m1pro.json`. This is a bounded model simplification with local throughput benefits, not completion of the architectural performance goal.
