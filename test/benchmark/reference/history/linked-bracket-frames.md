# Consume bracket frames in source order

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Retained source commit: `32b8360` — `perf: link bracket frames in source order`.

This extends the named-frame model from `9a9b552`. Only `packages/satorigear/src/profile/resolve.ts` changes: 21 added / 15 removed lines. The unminified bundle decreases from 161,599 to 161,592 B (7 B). No feature API, grammar-specific resolver, token layout or incremental correspondence rule changes.

Under the default controlled protocol, combined spec time decreases **0.70%**, CI [−1.00%, −0.40%], and Rust decreases **1.91%**, CI [−2.54%, −1.27%]. These are relative to the named-frame baseline, not the earlier numeric-frame baseline. Do not add the two experiments' percentages. No new remark reference was measured and the 100× goal remains unmet.

## Changed invariant and representation

After named records replaced numeric frame offsets, the frame array no longer supplied identity or parent lookup. Its only remaining readers consumed frames in raw-opener source order. Every raw opener creates exactly one frame; both later passes advance at the same opener test, including consumed syntax. They do not require random access.

The new `next` field stores this stable source order, independent of `parent` nesting. Analysis returns the first frame or `undefined`. Pairing and emission each advance their own local head reference. This removes the array, its growth/push operations, the shared empty-array sentinel and two numeric cursors. It does not remove analysis, pairing, emission, raw tokens, or semantic facts.

Source order already existed in array position; the linked form relocates that fact into the existing record. The head remains owned by the resolver call. Later stages borrow it, never rewrite `next`, and output only numeric tokens. No frame ownership escapes into ASTs or incremental caches. Parent and next references can form cycles, but the whole graph has the same resolution-local lifetime; no cleanup or ownership-transfer protocol is added.

An initial untimed implementation retained an unnecessary head-to-local-cursor alias and grew the bundle by 46 B. The final version advances the by-value function argument directly and removes those duplicate variables. This is the only measured candidate. Both source forms are archived; there is no minification change or unrelated code removal to satisfy the size gate.

This route depends on the newly retained direct frame references. It does not retry the earlier rejected numeric workspace allocation/reuse or default-feature traversal-fusion routes.

## Executed work and actual layout

Public parse probes preserve full AST/positions and produce equal counts in generated and forced-CSP modes:

| Corpus | Frames, both | Nonempty frame arrays, before → after |
| --- | ---: | ---: |
| spec | 379 | 192 → 0 |
| Rust | 7,726 | 5,329 → 0 |
| APIs | 1,806 | 1,806 → 0 |
| Unmatched opener guard | 1,600 | 1 → 0 |
| Nested-link guard | 800 | 1 → 0 |
| Component-label guard | 900 | 1 → 0 |

These count source-level constructions, not exact allocated bytes. V8 `%DebugPrint` confirms the observed frame layout grows from a 104 B / ten-property object to a 112 B / eleven-property object. The inspected linked cohort has FastProperties, all eleven properties in-object, and one shared map across four mixed link/image/component frames. The baseline also has a separate JSArray and its elements backing store. No claim is made that every heap state has the same layout or that an instrumented retained graph measures total allocation.

Tail append resolves one formatting region with zero bracket frames; removal resolves none. Empty-frame handling still executes on append, so this is not a zero-changed-code negative control.

## Controlled throughput

Node 26.13.0 / Apple M1 Pro, `taskpolicy -c utility`, fresh process/module per observation, alternating ABBA/BAAB, 250 ms warmup, full GC, one 150 ms settling round and approximately 300 ms measured with natural GC included. Each phase is capped at 500 ms. No own build, test or profile overlaps throughput.

All initial four and independent eight blocks are retained and combined for spec, Rust and APIs, using paired log ratios and Student t(11). Other rows have four blocks. Positive percentages are slower.

| Workload | Blocks | Change | 95% interval |
| --- | ---: | ---: | --- |
| spec | 12 | −0.70% | −1.00% to −0.40% |
| examples | 4 | −0.42% | −2.08% to +1.26% |
| Rust | 12 | −1.91% | −2.54% to −1.27% |
| APIs | 12 | +0.27% | −0.51% to +1.05% |
| document/spec | 4 | −0.55% | −1.49% to +0.40% |
| tail edit | 4 | +0.00% | −1.93% to +1.97% |
| 1,600 unmatched opening brackets | 4 | −8.19% | −8.51% to −7.86% |
| 400 nested-link groups | 4 | −1.60% | −2.02% to −1.18% |
| 300 component-label groups | 4 | −0.67% | −1.32% to −0.01% |
| repeated definition availability edits | 4 | −1.50% | −2.67% to −0.32% |

Initial spec was −0.73%, CI [−2.03%, +0.58%]; independent confirmation was −0.68%, CI [−0.88%, −0.48%]. Initial Rust was −2.10%; confirmation −1.82%. APIs' initial +0.48% and confirmation +0.16% both have intervals crossing zero. No batch was discarded. The reference-edit runner preserves paired settling; all recorded settling counts are even.

Crossing-zero results do not establish exact equivalence or universal non-regression. The candidate is retained on the tested simplification/performance evidence, with those uncertainty limits, not on an arbitrary minimum gain threshold.

## Runtime attribution and settling sensitivity

Observed natural GC per operation in the default throughput runs is approximately:

- spec: 19.39 → 17.91 μs;
- Rust: 1,320.26 → 1,234.78 μs;
- APIs: 395.59 → 418.37 μs;
- unmatched guard: 1.840 → 1.661 μs;
- reference edit: 8.614 → 7.943 μs.

GC is already included in elapsed time. Fewer arrays do not imply lower observed GC on every input or an exact decomposition of the speedup.

Separate four-block CPU diagnostics do not precisely reproduce the small spec delta: approximately 918.45 → 917.96 μs/parse, observed GC 19.62 → 19.15 μs. Samples move substantially among unchanged line scanning, boundary search and location routines as well as resolver code. This is insufficient to assign the unprofiled −0.70% to a particular instruction or named frame function.

APIs' CPU diagnostic reverses the small adverse throughput direction: approximately 2,841.49 → 2,816.57 μs/parse, observed GC 449.28 → 446.97 μs. The JIT/GC trace shows five measured major collections on each side, but different optimization activity: baseline has 35 dependent-code invalidations and seven bailouts during measurement; candidate has one bailout and no measured invalidation. Spec traces have ongoing optimization completions but no measured bailout/invalidation. These observations do not prove quiescence or identify a candidate GC regression.

Because the API diagnostic exposes runtime recovery activity, an additional **predeclared two-round settling sensitivity** comparison was run: two separate 150 ms rounds, each still under 500 ms. It is not pooled with or substituted for the default results:

| Workload | Blocks | Change | 95% interval |
| --- | ---: | ---: | --- |
| spec, two settling rounds | 4 | −0.50% | −1.37% to +0.39% |
| APIs, two settling rounds | 4 | −0.36% | −2.45% to +1.77% |

The sensitivity check does not reveal a new regression signal, but also does not independently prove a speedup or JIT stability. No speculative parser branch or GC-tuning workaround was added. The supported causal scope is the isolated representation replacement and its observed net effects, backed by counts showing the intended container removal; exact runtime cost allocation remains unresolved.

## Validation and disposition

All 196 existing tests, typecheck, changed-file lint and whitespace checks pass. Each backend additionally passes 2,614 full corpus AST/position comparisons; 612 definition-related documents and 4,284 edits against baseline and fresh parse; 4,608 feature edits against fresh parse; and 12 custom performance documents with 24 edits across three profiles against baseline and fresh parse. Six-feature Rust/APIs ASTs are also compared by the probes. No parser-private repository tests were added.

The current source and dist exactly match the measured final candidate. Source was committed on main with KazariAI identity and a title only, before the single trailing consolidated record commit. No development worktree, revert commit or push is involved.

`linked-bracket-frames-674d3d1-node26-m1pro.json` preserves all 288 unprofiled observations (256 default, 32 sensitivity), exact prototype/final source forms, frozen bundles, scripts, validation outputs, CPU profiles, JIT/GC and object-layout logs. In harness output A/B means baseline/final candidate; the probe's C label and `candidate-C.ts` name denote that same final candidate. `candidate-B.mjs` is the untimed preliminary alias version and must not be confused with the harness B label.
