# Record link closures during pairing

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Retained source commit: `098e136` — `refactor: record link closures during pairing`.

This is a state/dataflow simplification, not an established speedup. Under the default protocol, combined spec time changes −0.30%, with a 95% interval of [−0.62%, +0.03%]. A separate settling sensitivity check changes +0.32%, also crossing zero. Neither result proves exact equivalence or universal non-regression. No new remark comparison was run; 100× remains unproven.

Production changes only `packages/satorigear/src/profile/resolve.ts` (8 added / 11 removed lines). The unminified bundle shrinks from 161,592 to 161,371 B (−221 B). One public syntax/AST conformance case is added in `test/mdast-conformance.test.ts`. There is no feature API, token layout, parsing-pass, codegen/CSP, or incremental ownership change.

## Model and invariant

Previously, pairing determined each accepted link's opener and closing token. Emission then maintained another `referenceTop` stack, wrote `referenceParent` for each emitted opener, compared its top frame's closing token at each raw closer, and popped that stack when emitting a link boundary.

Pairing now writes `rawFrame.closingLink = frame` at the successful match. Emission reads this association from the raw frame it is already closing. `closingLink` replaces `referenceParent`; it does not add a field. This removes the output stack and its reconstruction of already-resolved closure ownership. Three passes, source-order frame links, raw nesting and logical opener selection remain.

The required invariant is that an accepted logical match has a pending raw frame at its closing token. Eligible logical openers remain represented in the pending raw nesting: feature-owned/consumed scopes do not enroll their hidden openers in the logical stack, and consuming a reference label cannot consume the raw entry of an earlier active opener. Reference labels exclude unescaped nested `[`; lexical atoms can hide a label's closer, leaving extra raw entries. Both pairing and emission advance raw nesting before their consuming/skipping checks, using the same stable `parent` and `next` relationships. Each raw frame is popped once, so the successful match can attach the exact emission owner to that raw closure.

Crucially, **the raw frame and semantic link frame need not be the same**. The public Markdown example below contains an image whose semantic closer belongs to a different raw frame:

~~~markdown
![[r][`]`](u)

[`]: /tick
~~~

Baseline, candidate and `mdast-util-from-markdown` agree on the complete AST and positions: the paragraph contains an image with alt ``r` ``, URL `u`, null title, and span offsets 0–13. The added repository test checks only this public output. It does not assert a private frame representation.

The diagnostic corpus covers 13,476 distinct bodies across default, footnote, and component/attributes/footnote profiles: 40,428 documents per backend. It observes 39,376 accepted closures, 72 with different raw/semantic frames, and zero with a missing raw frame. Forty-eight accepted semantic frames were originally raw-unclosed. Counts are corroborating evidence, not a substitute for the invariant argument or proof of all possible syntax. The first, narrower generator missed the crossed-frame cases; its output is preserved, and the refined generator explicitly includes partial reference labels and backtick atoms.

The association can point back to its own frame. All frames already have resolution-local lifetime; none escapes into output tokens, AST nodes or edit caches. This change does not introduce an ownership-transfer or cleanup protocol. It also does not justify merging raw and semantic nesting, or deleting the remaining passes.

## Executed work and V8 layout

Untimed instrumented public parses preserve full AST/positions and produce equal counts in generated and forced-CSP modes:

| Corpus | Frames, both | Old output pushes / pops | Old close predicates | New owner writes |
| --- | ---: | ---: | ---: | ---: |
| spec | 379 | 115 / 115 | 379 | 115 |
| Rust | 7,726 | 5,724 / 5,724 | 7,726 | 5,724 |
| APIs | 1,806 | 1,806 / 1,806 | 1,806 | 1,806 |
| Unmatched openers | 1,600 | 0 / 0 | 0 | 0 |
| Nested-link groups | 800 | 400 / 400 | 800 | 400 |
| Component-label groups | 900 | 300 / 300 | 900 | 300 |

The old parent-field write count equals its push count. Thus the field write is relocated, not eliminated. The old close predicate may short-circuit; these counts do not measure executed machine instructions or the cost of candidate field reads.

V8 `%DebugPrint` after emission shows 112 B instances and eleven in-object properties on both sides, with FastProperties. Four mixed link/image/component frames share a map within each inspected variant/backend cohort. The final field changes from `referenceParent` to `closingLink`; there are no fewer frames or new containers. This observation does not imply identical pointer contents, exact allocation totals, or universally identical GC cost.

## Controlled throughput

Node 26.13.0 / Apple M1 Pro, `taskpolicy -c utility`, fresh process/module per observation, alternating ABBA/BAAB, 250 ms warmup, full GC, one 150 ms settling round and approximately 300 ms measurement including natural GC. Each phase is capped at 500 ms. No own builds, tests or profiles overlap throughput. These are not M3 measurements.

All first-round and independent confirmation blocks are retained. Twelve-block rows combine initial four plus independent eight using paired block log ratios and Student t(11); four-block rows use t(3). Positive values are slower.

| Workload | Blocks | Change | 95% interval |
| --- | ---: | ---: | --- |
| spec | 12 | −0.30% | −0.62% to +0.03% |
| examples | 4 | −0.77% | −2.74% to +1.23% |
| Rust | 12 | −0.71% | −1.84% to +0.43% |
| APIs | 12 | −0.32% | −1.26% to +0.62% |
| document/spec | 4 | −0.23% | −1.27% to +0.83% |
| tail edit | 12 | −0.23% | −1.56% to +1.11% |
| unmatched openers | 12 | +0.35% | −0.20% to +0.90% |
| nested links | 4 | +0.18% | −0.45% to +0.81% |
| component labels | 4 | +0.02% | −0.23% to +0.28% |
| reference availability edit | 4 | +0.26% | −1.30% to +1.85% |

Default spec observation means are 910.995 → 908.282 μs. Initial spec changes −0.292%; independent confirmation −0.300%. Unmatched openers changes +0.349% initially and +0.345% in confirmation. These small repeated adverse estimates were investigated, not discarded or declared noise from their intervals alone.

## Runtime attribution and sensitivity

Separate four-block CPU profiles show spec elapsed 917.10 → 920.53 μs/parse and unmatched 65.373 → 65.472 μs/parse. Profiled times are diagnostic only. Spec samples move substantially among unchanged line scanning, boundary search and location routines. Unmatched self samples move from bracket analysis into emission and other helpers; sampling/inlining does not support assigning an exact fraction of this sub-percent delta to a source statement.

Unmatched has zero old parent writes/close predicates and zero new owner writes. The changed resolver functions still execute, so it is not a zero-changed-code control. V8 traces show the same token helpers and raw-token append helper being inlined into the emitter. Neither variant has measured bailouts or dependent-code invalidations. Both have six measured optimization completions. Measured GC trace counts are 140 versus 142 scavenges, with 7.709 versus 7.679 ms total pauses. Default throughput GC per operation is 1.737 → 1.733 μs. There is no supported allocation/GC-regression explanation for this guard's small adverse estimate.

Spec has seven versus six measured optimization completions, no measured bailout/invalidation, and 19 versus 18 scavenges in the JIT trace. Default throughput GC is 18.304 → 18.783 μs/parse. Removing the output stack does not establish lower GC cost, and post-GC optimization activity means quiescence must not be assumed.

To examine that unresolved sensitivity, a separately declared four-block comparison uses **two distinct 150 ms settling rounds**, preserving the phase cap. It is not pooled into or substituted for the default protocol:

| Workload | Change | 95% interval |
| --- | ---: | --- |
| spec | +0.32% | −0.58% to +1.22% |
| unmatched openers | +0.01% | −1.31% to +1.35% |

This does not establish a stable speedup, exact equivalence, or a proven JIT cause. No speculative branch or runtime-tuning workaround was added. The supported benefit is simpler emission state and smaller code; small runtime differences remain unresolved.

## Validation and disposition

197 tests, typecheck, changed-file lint, build and whitespace checks pass. Final dist matches the frozen measured candidate byte-for-byte. Each generated/CSP backend passes 40,428 topology-corpus AST/position comparisons; 2,614 standard corpus comparisons; 612 definition-related documents and 4,284 edits against baseline and fresh parse; 4,608 feature edits against fresh parse; and 12 custom documents with 24 edits. Six-feature Rust/APIs complete ASTs are also compared by the runtime probes. Private instrumentation stays in the diagnostic archive; the repository adds only the public syntax test.

Retained as a focused refactor without a hard minimum speedup threshold. Tested results do not establish a material regression, but their crossing-zero intervals must not be represented as proof of universal non-regression. Do not retry this unchanged association replacement to chase a claimed speedup. Revisit only if later topology, feature ownership, or runtime changes alter its premise.

`reference-close-ownership-1f1a90d-node26-m1pro.json` preserves all 352 unprofiled observations (320 default, 32 sensitivity), frozen source/bundles, scripts, complete validation outputs, V8 CPU/JIT/GC/layout logs and setup failures. Two initial probe-generation uniqueness assertions failed before any parse/throughput observation; the corrected scoped replacement and both failed scripts are preserved. Source was committed on main with KazariAI identity and a title only; evidence is folded into the single trailing consolidated record commit. No worktree or push is involved.
