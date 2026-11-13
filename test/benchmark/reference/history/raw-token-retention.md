# Raw inline stream lifetime

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Neither candidate is admitted. Both patches and all observations are preserved; main source and dist are restored byte-for-byte. The narrower structural finding is valid: definition-independent incremental regions do not need a distinct raw token stream after resolution. That finding is not an established CommonMark spec one-shot speedup, and the 100× goal remains unmet.

Baseline is `67e5022`, bundle SHA-256 `c98a3b1976e99d0d26cf3b64557fa8f6292b17c1ce28198bda2682508e9d2d38`. Existing local production commits remain unchanged. The prior 80.31× remark reference applies to that baseline; remark was not retimed here.

## Lifetime proof and history screen

An unchanged region can re-resolve only when its recorded definition dependencies change. With no dependencies, its resolved stream remains valid; changed source is always tokenized again. Consequently, a distinct raw stream has no future reader in a definition-independent region.

The old direct-AST prototype already released raw tokens without dependencies, but that prototype changed many other ownership rules and failed broader admission. No isolated test of this lifetime change in the current production architecture was found. This experiment does not repeat the rejected definition-availability variants: it changes neither definition queries nor dependency membership, and adds no normalization, lookup cache, feature API or persistent field.

Probes through public document construction, with full AST/positions compared to baseline, count only **distinct** raw/resolved arrays. Streams already sharing one array are not counted as savings. Codegen and forced-CSP counts agree:

| Input | Regions with distinct streams | No-dependency subset | Unneeded raw numeric slots |
| --- | ---: | ---: | ---: |
| spec | 222 | 30 | 668 |
| Rust | 5,379 | 2,506 | 31,404 |
| APIs | 1,806 | 0 | 0 |
| examples, 652 documents | 314 | 160 | 1,648 |
| 400 formatting paragraphs | 400 | 400 | 9,600 |

These are executed object/slot counts, not allocated bytes. APIs' direct-resource links still have the existing conservative definition dependency; this experiment deliberately does not change that separate behavior.

## Two implementations, one production file

Only `packages/satorigear/src/inline/region.ts` changes.

- **B:** retain raw tokens only when the tracker recorded dependencies; otherwise store `undefined`. Use the existing resolved tokens to determine whether the region has been initialized. Bundle 161,627 B, 16 B smaller than baseline.
- **C:** preserve raw-cache presence as the initialization proof, using the existing shared empty array when no raw cache is needed. Delete the now-unnecessary local alias. This preserves an array value after initialization while releasing the source-specific array. Bundle 161,643 B, exactly baseline size; production diff is four added/five removed lines.

C is an isolation adjustment after B's tail regression and runtime analysis. It is not proof that field-type changes caused B's regression. Neither version adds a parser mode, ownership transfer, new cache field or source/definition shortcut. In both, reaching re-resolution with unchanged source implies a prior nonempty dependency set and therefore an available raw stream.

## Correctness

B passes all 196 existing tests, typecheck and build. C passes typecheck/build and the complete differential checks below. Public declaration files are identical. No parser-private test was added.

Each variant, in each backend, passes:

- 2,614 full corpus AST/position comparisons;
- 612 definition-related documents and 4,284 edits, comparing baseline and fresh parses;
- 4,608 all-feature edits compared with fresh parse;
- 288 explicit transitions between formatted text, references, direct links, footnotes/components and plain text, including adding/removing definitions and shifting source prefixes.

These are differential checks, not a new universal conformance claim.

## Throughput and retained heap

Node 26.13.0 / M1 Pro, `taskpolicy -c utility`, fresh processes/modules, 250 ms warmup, full GC, 150 ms settling, natural GC included, alternating ABBA/BAAB and approximately 300 ms measured windows. Positive percentages are slower. C's spec/document/tail results combine the initial four and independent eight blocks using paired log ratios and Student t(11), retaining every observation. Other rows have four blocks.

| Input | B vs baseline | C vs baseline | C 95% CI |
| --- | ---: | ---: | --- |
| spec | +0.58% | +1.48% | +0.57% to +2.41% |
| examples | −0.99% | −2.24% | −3.84% to −0.60% |
| Rust one-shot | −3.01% | −2.76% | −3.41% to −2.12% |
| APIs one-shot | −1.90% | +0.04% | −4.47% to +4.76% |
| document/spec | +1.14% | +0.71% | −0.37% to +1.80% |
| tail edit | +3.44% | −0.31% | −1.50% to +0.89% |
| document/formatting | −14.30% | −15.50% | −16.66% to −14.33% |
| repeated reference edit, phase-correct | not measured | −0.04% | −2.23% to +2.21% |

The formatting result has supporting allocation/GC evidence. In C's unprofiled comparison, arithmetic elapsed means are approximately 611.93 → 517.05 μs/document, with observed GC approximately 121.25 → 37.77 μs/document. GC is included, not subtracted from admission timing. This supports reduced collection pressure; the time difference is not an exact causal decomposition.

Separate fresh-process ABBA/BAAB memory diagnostics retain one live document and collect full GC before/after construction. Mean V8 used-heap deltas for C are approximately 1,709,170 → 1,527,138 B for formatting and 19,603,448 → 19,021,876 B for Rust. These are whole-heap deltas, not exact raw-array bytes; four observations per variant and corpus show the same direction. B shows a similar reduction. No cross-document cache is introduced.

### Tail attribution and adjustment

Public tail-edit probes produce identical work in baseline/B/C: append visits 13 region updates, performs 12 dependency checks and resolves one eight-slot raw stream; removal visits 12 updates/checks and resolves nothing. No extra tokenization or dependency work was identified.

B's measured tail GC is about 1.09 → 1.39 μs/edit, smaller than its full elapsed difference. Its separate CPU diagnostic reverses the elapsed direction and shows similar GC. JIT diagnostics have ongoing optimization completions but no measurement bailout/invalidation. These observations do not establish an instruction-level cause. C restores the initialization predicate and array-valued cache representation; its combined tail interval crosses zero, rather than proving exact equivalence or a specific causal fix.

## Unexecuted-path discrepancy and negative controls

The one-shot path does **not** construct or update incremental inline regions. A public parse probe confirms zero calls to the changed update routine, dependency checks and region resolution in both baseline and C. Accordingly, neither the favorable Rust/examples one-shot observations nor adverse spec observations can be attributed to executing the changed cache algorithm.

C's four-block spec CPU diagnostic also reverses the unprofiled direction. Physical `BlockLines.#scan` self samples are essentially equal (about 266.6/266.5 μs/parse), while other functions move in both directions. Detailed JIT traces show four post-warmup-GC invalidations and ten settling invalidations in both, seven/six measurement optimization completions, and no measurement bailout/invalidation. Sampling and these traces do not identify a code-layout, GC or compiler cause.

An A/A control uses the **same file path and SHA-256** on both sides, with identical worker flags:

| Control | Apparent change | 95% CI |
| --- | ---: | --- |
| initial four blocks | +2.85% | +2.36% to +3.34% |
| independent eight blocks | −0.40% | −0.94% to +0.13% |

The first result is a false positive against a known identical artifact. The second does not reproduce a systematic bias. A single failed control does not prove a harness bug or invalidate every measurement; it does expose uncertainty in assigning small short-batch effects to code. No control percentage is subtracted from A/C, and no new reference ratio is inferred. Inspection confirmed identical paths, hashes and Node arguments. A later process snapshot did not identify a high-CPU benchmark process; that snapshot is not proof that all earlier measurements were free of external interference.

No repository benchmark algorithm was changed on an unproven diagnosis. Source correctness and memory reduction are established within the tested scope; overall performance admission remains unresolved. The candidates are therefore withheld and removed from the working tree, not classified as disproving the cache-lifetime invariant.

## Validation audit and preserved failures

The temporary runner initially added `incremental/references` without extending the paired-settling condition. B had 11/16 and C 6/16 observations ending at an odd edit phase. Both original reference reports remain archived, but their apparent −1.38%/−1.34% gains are **excluded from admission**. A separately frozen runner pairs both settling edits and preserves the original measurement loop. Its phase-correct C result is the final reference row above; all settling counts are even. The repository's original `incremental/tail` runner was already phase-correct and was unaffected.

Two setup/analysis failures occurred before any new accepted result: Node refused to strip a cache-local TypeScript harness under `node_modules`, so an explicit stripped `.mjs` was produced; the initial combined analysis called the four/eight-block helper with twelve blocks, so a separate analysis implemented the same estimator with t(11). Original scripts/reports are preserved. Neither failure caused a throughput worker to restart or a sample to be dropped.

## Disposition and next boundary

All experiments ran visibly on main. Both candidate patches, frozen bundles, public checks, V8 memory/profile/JIT diagnostics, controls and raw timing observations are in `raw-token-retention-67e5022-node26-m1pro.json`. The original source and bundle are restored; only the trailing consolidated record commit is amended.

The archive retains 416 unprofiled observations, including 48 control observations and the 32 phase-invalid reference observations explicitly excluded above. The longest measured window is 299.455 ms. No own build, test or profile overlaps throughput. The first A/A control overlapped a short read-only profile-summary script; its independent confirmation ran without other analysis scripts. This difference is disclosed, not asserted to explain the first control's four adverse blocks.

Do not rerun these exact B/C variants unchanged or claim their one-shot percentages as executed-work savings. Reopening needs new evidence explaining the unexecuted-path discrepancy or a lifecycle change that removes the documented tradeoff. The retained architectural finding is narrower and useful: dependency information already supplies a liveness proof for raw syntax caches, and releasing those caches can materially reduce GC on document construction. It is not a substitute for the spec 100× objective.
