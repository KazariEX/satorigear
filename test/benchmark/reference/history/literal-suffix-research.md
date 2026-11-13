# Literal suffix representation after the upstream sync

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

No production change is admitted. Main was rebased onto `8aa9ee5`; the candidate was implemented visibly there and then removed. The restored source tree is `c7b3facdda5b13409a0822025d48c1a00e38b5e5`, with bundle SHA-256 `c98a3b1976e99d0d26cf3b64557fa8f6292b17c1ce28198bda2682508e9d2d38` (161,643 B). The historical 80.84× remark result measures a different bundle and cannot be transferred to this source.

## Hypothesis and actual work

The inline builder keeps final text and a `pendingLiteral` suffix used to trim literal spaces/tabs while preserving decoded whitespace. B replaces the suffix string with the count of trimmable literal whitespace. It inspects only newly appended fragments, never the merged text. This differs from rejected candidate 22, which scanned merged output and incurred a large sparse-escape regression.

**History-audit correction:** the initial search missed `literal-suffix-810bb39-node26-m1pro.json`. That archive already records accepted commit `4a9c16d` changing eager numeric suffix tracking into the current literal-string representation, avoiding the same 703 spec checks. It also records the rejected source-coordinate variant and its attribute counterexample. B reverses that accepted optimization; it is **not a novel route**, and no material invariant change justified this repeat. The measurements are preserved transparently, but this experiment should have stopped at the history screen. Future history searches must cover accepted mechanisms and standalone archives, not only the rejected-candidate list and Markdown summaries.

Counters in frozen bundles, exercised through public parsing, disprove the expected stock-corpus string-concatenation savings:

| Input | A: concatenations of two nonempty suffix fragments | A: suffix checks | B: suffix checks |
| --- | ---: | ---: | ---: |
| CommonMark spec | 0 | 313 | 1,016 |
| CommonMark examples, complete batch | 0 | 107 | 299 |
| Rust releases | 0 | 1,490 | 8,102 |
| Public APIs | 0 | 9 | 16 |
| Sparse escaped punctuation | 0 | 1 | 60 |

The original suffix usually references an already produced string. Its existence does not prove an extra character buffer or rope allocation. B eagerly checks many fragments that A never inspects. These are executed call/concatenation counts, not allocated-byte or native character-comparison measurements.

The concatenation path is nevertheless reachable: 300 terminal attribute-chain paragraphs (`x\t{#a}\t{#b}\t`) produce 600 nonempty suffix concatenations. Attributes can separate source fragments while leaving them adjacent in the output text. Replacing the suffix with one contiguous source span would lose this distinction; that adjustment was screened out without implementation rather than introducing another interval representation.

## Throughput and size

Node 26.13.0, Apple M1 Pro, `taskpolicy -c utility`; four alternating ABBA/BAAB blocks per case, fresh subprocess/module state, 250 ms warmup, full GC, 150 ms settling, approximately 300 ms measured windows including natural GC. All 80 observations are retained; maximum measured window is 299.504 ms. Own builds, tests and profiles did not overlap throughput. Positive changes mean slower.

| Input | B vs A | 95% CI |
| --- | ---: | --- |
| spec | +0.22% | −5.26% to +6.02% |
| examples | −2.80% | −8.44% to +3.18% |
| sparse escapes in long literal text | −1.71% | −6.12% to +2.90% |
| attribute-separated whitespace | −0.44% | −1.66% to +0.79% |
| decoded whitespace and soft breaks | +1.38% | −2.90% to +5.86% |

These intervals establish neither improvement nor equivalence nor a regression. B is 161,703 B, **60 B larger**. Broad incremental admission measurements were not run: the proposed stock-corpus work reduction did not occur, and size already fails the goal. This is not rejection for missing an arbitrary speedup threshold.

## Runtime evidence and limits

Two exploratory baseline CPU profiles still put physical-line scanning near a quarter of spec time. Historical galloping locator and whole-source fence-search experiments were checked and not repeated; no material change to their cost model was established.

A separate four-process ABBA CPU diagnostic for the suffix candidate clips samples to the measured `hrtime` window and verifies the profiler-start clock bracket. Effective sampling intervals are about 940–965 μs despite requesting 100 μs. `appendText` self samples move from about 2.99 to 9.47 μs/parse, while samples move in the opposite direction in callers. These coarse, inlining-sensitive values are not an additive explanation of the small throughput estimates. GC event time is about 21–23 μs/parse in both variants.

Separate ordinary JIT traces observe no measurement-phase bailout or dependent-code invalidation in either run. Warmup/settling behavior differs: A has four post-warmup-GC invalidations and ten settling events; B has none in those phases. A single diagnostic pair does not establish a causal throughput benefit or JIT quiescence. Raw logs and phase extraction are archived.

## Validation and disposition

B passes 196 existing public tests, typecheck and build. Each of codegen and forced-CSP modes passes 2,614 complete corpus AST/position differential comparisons and 6,078 tail-text combinations comparing one-shot and document construction against A. No parser-private tests were added. These are differential checks, not additional claims of normative correctness; candidate edit throughput was not measured.

The candidate source and bundle are archived, and production source was restored exactly. A fresh build reproduces the baseline bundle byte-for-byte. Do not retry eager numeric suffix tracking or the already-rejected coordinate suffix unchanged. Reopening requires a producer or traversal change that actually removes work while preserving literal/decoded whitespace and decorator-separated source segments; scanning merged text remains excluded by the historical evidence.

Frozen bundles, patch, scripts, all observations, CPU profiles, JIT logs, counters and restoration hashes are in `literal-suffix-research-c0d2385-node26-m1pro.json`. The 100× goal remains active and unachieved.
