# Current baseline and inline entry search

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

No production change is admitted. The tokenizer experiment is withdrawn after correctness checks, six workload comparisons and runtime attribution. The restored bundle is byte-identical to main before the experiment: 161,643 B, SHA-256 `c98a3b1976e99d0d26cf3b64557fa8f6292b17c1ce28198bda2682508e9d2d38`. The 100× goal remains unmet.

## Fresh reference after upstream synchronization

Base main is `0dd415f`, source tree `c7b3facdda5b13409a0822025d48c1a00e38b5e5`, with upstream `8aa9ee5`. A fresh fetch found no newer upstream commit. Main has two local production changes: HTML tag classification (`7e7c1ab`) and single-event hard breaks (`52a1c4a`). Other local commits are tests, tooling and records.

Eight alternating ABBA/BAAB blocks measure **80.31× remark**, 95% ratio interval **79.28–81.35×**, on Node 26.13.0 / Apple M1 Pro. Arithmetic observation means are 938.52 μs for main and 75,358.55 μs for remark. The reported ratio uses paired log ratios, not the ratio of those arithmetic means. At the fixed reference point estimate, reaching 100× requires about 19.69% less parser time. This result applies to the restored main bundle, not the candidate or the user's M3.

## Cumulative comparison and isolation

Positive values mean slower. Four blocks per case compare upstream A to main B:

| Case | Change | 95% CI |
| --- | ---: | --- |
| spec | +1.68% | +0.27% to +3.10% |
| examples | −0.78% | −4.29% to +2.85% |
| Rust | −1.92% | −4.18% to +0.39% |
| APIs | −0.48% | −1.90% to +0.96% |
| document/spec | +0.43% | −2.35% to +3.29% |
| tail edit | −0.78% | −3.86% to +2.41% |

The spec signal requires investigation; crossing zero on the other cases does not prove equivalence. Separate four-block isolation comparisons give:

| A → B | Spec change | 95% CI |
| --- | ---: | --- |
| upstream → HTML-only | +1.68% | +0.08% to +3.30% |
| HTML-only → main, adding hard breaks | +1.38% | −0.52% to +3.32% |

These separate observations cannot be added as an exact causal decomposition. No existing production commit is removed on this evidence alone.

Frozen source builds use a load plugin at the original source module paths, with the original package context and build configuration. Rebuilding the main export reproduced main byte-for-byte before comparing upstream. Initial builds directly under the cache's `node_modules` path emitted extra enum initialization code; those builds are excluded from all measurements.

### HTML runtime investigation

A counter probe through public spec parsing observes exactly **one `htmlStartAt` call, on an 18-character body**, in both versions, with identical full AST/positions. The counter is not an elapsed-time measurement. This makes a claim that repeated tag matching directly explains the aggregate regression unsupported.

Four ABBA/BAAB CPU-profile blocks show the largest self-sample movement in unchanged physical `BlockLines.#scan`: approximately 254 → 287 μs/parse. The call-frame URL and source line were checked; this is not a collision with another method named `#scan`. Other functions move in both directions, including `closesFence` at roughly 45 → 34 μs/parse. Mean observed GC time is about 21.0 → 22.7 μs/parse. Sampling is coarse and affected by inlining; these numbers are diagnostic, not exact additive attribution or throughput admission.

Detailed JIT runs have the same counts of post-warmup-GC invalidations (4), settling invalidations (9) and measurement optimization completions (6). Neither diagnostic run records a measurement bailout or invalidation. This does **not** establish the cause of the difference. In particular, no code-layout, allocation or GC explanation is promoted from a hypothesis to a finding. The cumulative signal remains unresolved.

## Candidate: one boundary search owns inline entry

The only source edit removes the leading-space loop from both generated and CSP tokenizers. The existing boundary search starts directly at zero. Actual registered markers exclude Space, and the boundary expression already skips those spaces while retaining relevant line endings. Implicit text remains owned by the builder; this is not text trimming. No feature API, token field or state is added.

Bundle size is 161,532 B: **111 B smaller than main**, 14 B smaller than upstream. The archived patch changes only `packages/satorigear/src/inline/tokenize.ts`.

Each backend passes 2,614 complete corpus AST/position differential comparisons, plus 11,232 leading-space/syntax combinations, 312 document constructions and 624 edits. The latter exercises default, attributes-only and full feature profiles. These compare public parse/document results; no parser-private test is added. They do not claim arbitrary future private marker configurations have identical behavior.

### Candidate throughput

Four blocks per case compare main A to the entry-search candidate B:

| Case | Change | 95% CI |
| --- | ---: | --- |
| spec | −0.25% | −0.91% to +0.42% |
| examples | −3.24% | −4.72% to −1.74% |
| Rust | −0.37% | −1.78% to +1.06% |
| APIs | +0.64% | −3.24% to +4.68% |
| document/spec | +2.54% | +1.33% to +3.77% |
| tail edit | −0.07% | −3.26% to +3.22% |

The document regression blocks admission, despite the examples improvement and simpler source.

### Investigating the document regression before disposition

Four CPU-profile blocks do not reproduce the direction: diagnostic means are about 1,067 → 1,043 μs per document, with GC about 18.7 → 17.2 μs. These profiled values do not replace unprofiled observations.

Detailed JIT traces show 86 post-warmup-GC invalidations in each version and measurement optimization completions in both. A predeclared sensitivity comparison adds one 150 ms settling round, leaving each phase below 500 ms. Four blocks then give −0.34%, CI −2.61% to +1.99%. The original +2.54% result is retained, not overwritten or pooled with the changed protocol.

A separate ordinary `benchmark-abba --jit --settle-rounds 2` diagnostic collects 16 runs. Each version still has 40 measurement optimization completions in total (five per run), zero measurement invalidations and zero measurement bailouts. The named completions include `#updateTree`, `linkDestinationEnd`, `blockQuoteOffset`, `endsWithParagraphLeaf` and an anonymous function. Extra settling does not establish JIT quiescence, and the symmetric event counts do not identify a candidate-specific cause.

The evidence establishes sensitivity to runtime/protocol state, not that GC caused the first regression or that the candidate is universally neutral. No additional branch, cache or ownership change is justified by these logs. The candidate remains unqualified and is removed from source and dist. This is not rejection for missing a hard speedup threshold. Do not repeat the unchanged entry-loop experiment; reopen only with evidence explaining the document discrepancy or a material change to the tokenizer/workload lifecycle.

## Protocol and evidence

All execution uses `taskpolicy -c utility`. Throughput uses fresh processes/modules, 250 ms warmup, explicit full GC, 150 ms settling (two rounds only for the declared sensitivity), approximately 300 ms measured windows including natural GC, and alternating ABBA/BAAB. Own builds, tests and profiles do not overlap throughput. All 272 throughput observations are preserved; the maximum measured window is 299.141 ms. CPU/JIT diagnostics are stored separately and excluded from admission estimates.

`entry-search-and-current-baseline-0dd415f-node26-m1pro.json` contains the reports, frozen bundles, patch, runners, probes, profiles, JIT logs and byte-identical restoration proof. Source artifacts use hashed gzip/base64 encoding. The trailing consolidated record commit is amended; no production candidate or revert commit is created.
