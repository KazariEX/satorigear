# Delimiter classification timing and formatting declarations

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Retained source: **`7692fbb` — `refactor: derive formatting scans from delimiter declarations`**.

This is a small declaration simplification, **not an established throughput improvement**. It changes only `packages/satorigear/src/profile/features/formatting.ts`: a local `FormattingDelimiter` type includes its marker; existing scan rules are derived from the enabled delimiter declarations. The shared scanner's character-to-token branch and the separately maintained scan list disappear. No core feature API, token field, pairing phase, ownership rule or parser mode changes. Each enabled delimiter gets a scanner closure at profile construction, not per parse.

Raw bundle size falls **160,983 → 160,838 B**; deterministic gzip-9 falls **33,523 → 33,487 B**. Codegen and CSP remain. The generated spec result is **+0.05%**, CI **[−0.31%, +0.41%]**, so this does not establish progress in the spec/remark ratio. No new remark comparison was run; the 100× objective remains unmet.

## Architectural experiment and rejection evidence

The intended larger change was to compute delimiter eligibility once during lexing, omit impossible runs, and reuse intrinsic source facts across definition-only edits. Screening found 206 formatting runs in spec, **none intrinsically ineligible**. Rust has 342 runs, including 219 that cannot flank. The opportunity is therefore corpus-dependent, not a general spec token reduction.

Later history audit: historical candidate 20 in `progress-node26-m1pro.json` and the earlier `inline-recognition-research.md` screen already cover this lexical-classification direction and the opaque-content work risk. B/C should not be presented as a wholly new premise. The final E declaration simplification remains a separate change. See [the audit correction](line-producer-history-audit.md); the original frozen experiment artifacts are preserved unchanged.

| Variant | Model | Raw bundle | Decision |
| --- | --- | ---: | --- |
| A | Accepted source `20f4f59` | 160,983 B | Frozen baseline |
| B | Compile scans from delimiter declarations; classify during lexing and omit inactive runs | 160,875 B | Incorrect; never timed |
| C | Preserve all raw boundaries; store eager flanking/modulo facts in existing Data | 160,925 B | Validated, but opaque-label work regresses |
| D | Defer classification again; compiled core delimiter config still owns a scanner | 160,877 B | Superseded by narrower E; no established throughput gain |
| E | Derive scans locally in formatting; all core contracts restored | **160,838 B** | Retained as simplification, with measurement limits below |

B changes public syntax behavior with attributes. Minimal differential example `** {}` has identical text value and paragraph attributes but different text end offsets (A: 5, B: 4). A larger counterexample also changes whitespace values. Inactive raw runs still establish literal boundaries used by decorators and trailing-text projection. Being unable to pair does **not** prove a run is removable. The basic corpus/edit checks passed B, but the broader delimiter/topology matrices found this failure before any timing. No private parser test or syntax-specific repair protocol was introduced.

C preserves boundaries and passes the full differential checks, but moving classification earlier performs work for syntax later consumed opaquely:

| Workload | Baseline flanking calls | C flanking calls |
| --- | ---: | ---: |
| spec | 206 | 206 |
| Rust | 239 | 342 |
| APIs | 104 | 104 |
| 652 CommonMark examples | 416 | 416 |
| `[^*a*]` repeated 800 times, with a footnote definition | 0 | 1,600 |
| Two definition insertion/removal edits over 400 `[ref] *emphasis*` paragraphs | 1,600 | 0 |

C's normal ABBA gives **+7.34% [+6.15%, +8.56%]** on consumed footnote markers, versus **−5.33% [−6.43%, −4.22%]** on reference edits. Spec is +0.54% [−0.35%, +1.45%]. The saved edit work does not offset an unrelated one-shot regression.

Runtime diagnostics support the changed-work explanation. On consumed markers, profiled elapsed changes 295.00 → 314.89 μs, observed GC 5.36 → 5.30 μs, and flanking self samples 0 → 8.12 μs. On reference edits, elapsed is 202.62 → 194.24 μs, observed GC 8.19 → 8.43 μs, and flanking self samples 3.07 → 0 μs. These are sampled diagnostics, not additive causal decompositions or throughput admission results. Both groups still observe optimization completions during measurement; they do not prove JIT quiescence.

D restores baseline classification timing and exact raw vectors. Direct C → D control improves the consumed guard **7.65% [5.80%, 9.46%]**. Do not subtract this from independently measured A/C results. D's initial APIs +1.73% prompted CPU/JIT inspection and eight additional blocks. All twelve A/D API blocks combine to **+0.94% [−0.49%, +2.39%]**. Profiled API elapsed is 2,795.91 → 2,837.39 μs with GC 418.58 → 457.23 μs; inlining shifts function attribution, and both variants have one measured bailout. This does not establish a unique cause or equivalence. D also grows gzip by 89 B despite reducing raw bytes. Review then removed its unnecessary core scanner/config integration, producing E.

## Final E measurements

Node **26.13.0**, absolute executable, **Apple M1 Pro**, `taskpolicy -c utility`. These are not M3 measurements. Alternating ABBA/BAAB, fresh process/module for each observation, 250 ms warmup, full GC, 150 ms settling, approximately 300 ms measured with natural GC and a 500 ms cap. Own tests, builds, profiles and throughput runs do not overlap. All observations, including unfavorable and variable blocks, are retained. Positive means slower.

| Generated path | Change | 95% CI |
| --- | ---: | --- |
| spec | +0.05% | [−0.31%, +0.41%] |
| examples | +1.47% | [−0.80%, +3.79%] |
| Rust | −0.21% | [−1.77%, +1.38%] |
| APIs | +0.97% | [−1.70%, +3.71%] |
| document/spec | +0.04% | [−0.63%, +0.71%] |
| tail edit | +0.28% | [−2.32%, +2.94%] |
| reference edits | −0.99% | [−2.21%, +0.24%] |
| consumed footnote markers | +0.10% | [−1.71%, +1.95%] |
| dense formatting | +0.21% | [−2.83%, +3.34%] |
| inactive literal delimiters | −0.02% | [−0.79%, +0.75%] |

Each generated row has four blocks. Forced CSP uses `--disallow-code-generation-from-strings` in every observation process:

| CSP path | Change | 95% CI |
| --- | ---: | --- |
| spec, four blocks | +0.08% | [−1.25%, +1.43%] |
| APIs, four blocks | −0.29% | [−2.29%, +1.74%] |
| dense formatting, all twelve blocks | +1.00% | [−1.11%, +3.15%] |

CSP formatting initially gives +1.79% [−2.01%, +5.73%], then independent eight-block confirmation +0.61% [−2.53%, +3.85%]. The combined interval uses paired block log ratios with Student t(11). Neither the confirmation nor the combination discards the initial result. **Crossing-zero intervals do not prove equivalence or exclude a modest regression**; E is admitted for local simplification and smaller raw/gzip output with no resolved regression in these measurements, not for a claimed gain.

CSP formatting CPU diagnostics precede confirmation: elapsed 541.67 → 548.71 μs, observed GC 41.39 → 41.19 μs. Named `scan` self samples change 0.21 → 2.46 μs; `resolvePairedSyntax` changes 41.48 → 38.82 μs. Function-name aggregation and inlining prevent attributing all elapsed change to the scanner. No optimization/bailout/invalidation event is recorded during measurement in the two phase-tagged JIT diagnostics; this is evidence about those runs only. Raw call frames, phase logs, measurement-clock audits and ±100 μs clipping sensitivity remain archived.

## Correctness and reproducibility

E passes build, typecheck, changed-file lint and all **198 existing tests**. Each generated/CSP backend passes 2,614 corpus AST/position comparisons, 4,608 feature edits, 612 definition documents / 4,284 edits, previous syntax guards, 3,072 indented-code documents / 6,144 edits, and 45,000 lexical-boundary documents / 80 edits. Runtime probes compare complete AST/positions, **entire raw token vectors including Data**, and flanking counts with A: E preserves them. C additionally passed 46,812 delimiter-matrix and 54,092 topology documents per backend; those larger matrices were not repeated for D/E. No parser-private repository test is added.

Canonical bundles, B/C/D source snapshots, E patch, baseline source, failed B counterexamples, validation snapshots, all **560 normal throughput observations**, and **64 CPU plus 8 JIT diagnostic processes** are preserved in `delimiter-lexing-86e42e5-node26-m1pro.json`. Normal observations cover C, C/D control, D initial/confirmation, E generated, and E CSP initial/confirmation. B has no timings. The `candidate.mjs` validator alias progressed through variants; archived `validation-B/`, `validation-C/`, `validation-D/` identify earlier outputs, while final top-level validation describes E. Old B failure files remain historical evidence, not claims that E failed.

The initial screen probe had an incorrect bundled-code insertion marker and failed before parsing; the corrected screen compares ASTs. Both setup attempts are retained. The final bundle hash is `cb48a7a3f3bf1cd62b4c3ab009dede544560c3776c77a017105a4c28f8b33107`.

Do not retry eager flanking classification on unchanged premises or assume non-pairing tokens can simply be deleted. A future elimination must first remove the decorator/text-boundary dependence and avoid classifying opaque label contents. E alone changes neither prerequisite. Source was committed on the original main worktree with KazariAI identity and a title only, before the single consolidated records commit; nothing was pushed.
