# Project literal line prefixes directly

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Accepted source: `dcf11a6` — `perf: project literal line prefixes directly`.

Only `src/block/lines.ts` changes: 15 insertions, 18 deletions; the production bundle shrinks **149 B**, from 162,777 to 162,628 B. There is no minification change, feature API, token/line layout change, persistent state, cache or ownership transfer. Generated dispatch and CSP remain intact.

## Invariant and data flow

`logicalLine` previously computed the physical column at the projected start of every line, maintained that value while consuming spaces, and reconstructed those spaces into a temporary string. Physical columns matter here only when the leading indentation contains a tab.

The existing loop processes logical columns below four. At the first tab, the logical width is `4 - column`; advancing by at least that width always reaches column four. Consequently, this operation can adjust **at most one tab**. There is no continuing physical-column state to maintain.

The new path finds the possible first tab, keeps ordinary spaces in their original source slice, and computes the physical column only when that tab needs consideration. If padding is positive, it inserts padding at that one boundary. Otherwise, the complete literal source slice passes through unchanged. Virtual leading spaces and existing tab-compensation semantics are preserved.

A preliminary B variant only deferred the physical-column query. It passed syntax checks but was not independently timed or committed. The accepted C variant also removes per-space string rebuilding; all reported performance results are C versus the accepted baseline `b27a41d`.

## Controlled measurements

Node 26.13.0 / M1 Pro, `taskpolicy -c utility`, fresh processes and modules, alternating ABBA/BAAB, 250 ms warmup, full GC, 150 ms settling and approximately 300 ms measured windows including natural GC. No own builds, tests or profiles overlapped throughput. All **272** normal observations are retained; maximum measured duration was **299.263 ms**. No M3 replication or new remark run was performed.

Negative means less elapsed time:

| Input | Blocks | Change | 95% CI |
| --- | ---: | ---: | --- |
| spec | 12 | +0.634% | [−0.380%, +1.659%] |
| CommonMark examples | 12 | −2.085% | [−3.034%, −1.126%] |
| Rust | 4 | +0.348% | [−3.307%, +4.142%] |
| APIs | 12 | −0.550% | [−2.201%, +1.128%] |
| Ordinary tail edits | 4 | +0.309% | [−2.193%, +2.876%] |
| Document construction / spec | 4 | −2.308% | [−3.935%, −0.654%] |
| Nested quote, literal space prefixes | 4 | −31.735% | [−33.751%, −29.657%] |
| Nested quote, tab prefixes | 4 | −9.864% | [−10.605%, −9.118%] |
| Quote, mixed indentation | 4 | −10.324% | [−14.089%, −6.395%] |
| Projected-space insertion/undo edits | 4 | −13.123% | [−13.886%, −12.354%] |
| Projected-tab insertion/undo edits | 4 | −7.506% | [−8.304%, −6.701%] |

Spec, examples and APIs combine all initial four and independent eight blocks using paired log ratios and a Student t(11) interval. Spec has **no established speedup**. Crossing-zero intervals do not establish exact equivalence or universal non-regression. The candidate is retained for the simpler projection model and resolved gains in the affected container workloads; this does not satisfy the complete 100× goal.

The API result requires explicit qualification. Its initial four blocks regressed **+2.212%**, CI [+0.644%, +3.805%]. Its separate eight-block confirmation improved **−1.904%**, CI [−3.543%, −0.236%]. Neither batch is discarded. The changed function is never called by this workload; neither direction can be attributed to its algorithm.

The projected edit benchmark inserts and removes a string containing blank lines inside the input. It can alter container structure; it is not a single-character edit. Its exact edit sequence was checked against both baseline and fresh parse results.

## Runtime evidence

Counters exercised through public parsing show:

| Input | Logical lines, unchanged | Physical-column queries | Per-space string appends |
| --- | ---: | ---: | ---: |
| Default spec | 82 | 82 → 0 | 22 → 0 |
| Rust | 268 | 268 → 0 | 340 → 0 |
| Examples | 51 | 51 → 3 | 64 → 0 |
| Nested quote, spaces | 802 | 802 → 0 | 1,600 → 0 |
| Nested quote, tabs | 802 | 802 → 800 | 1,600 → 0 |

An initial probe reported 20 spec calls because it enabled six optional features. The final probe uses the default CommonMark configuration matching the benchmark and reports 82; the initial probe remains archived with its script.

Independent CPU profiles of the space-prefix workload show `physicalColumnAt` self samples falling from **56.987 to 0 μs/parse** and `logicalLine` from **14.418 to 11.111 μs/parse**. GC is approximately 2.946 versus 2.841 μs/parse. This supports eliminated prefix traversal; it does not prove an exact allocation-byte reduction or fewer physical rows/tokens. Sampling overhead prevents additive throughput accounting.

API CPU differences are spread across unchanged functions. Its separate JIT traces show full-GC invalidation in both versions, one measured bailout in each, and eight/nine measured optimization completions. This exposes ongoing runtime activity but does not precisely explain the opposing throughput batches. No JIT-quiescence claim is made.

## Validation and an inherited correctness finding

The isolated candidate and the final working combination each pass all **194 existing tests**. Typecheck and lint pass; the verified build is byte-identical to the measured C bundle, and public declarations are unchanged.

Each B/C backend, generated and forced-CSP, additionally passes 2,614 complete corpus AST/position comparisons, 4,608 feature edits, 5,670 fence documents with 56 edits, and 2,916 projected code/math documents with 8,748 edits. C also passes the exact synthetic workloads and their edit sequences. No parser-private tests were added.

An additional public-syntax reference screen found an **existing** tab-content discrepancy. For:

```text
> ```
>   \tx
> ```
```

Here `\t` denotes an actual tab. Baseline and candidate both produce code value `"  \t  x"`; `mdast-util-from-markdown` produces `"  \tx"`. In a matrix of 672 quote-depth/indent/tab/line-ending combinations, 228 code-value comparisons differ from the reference, while baseline and candidate complete ASTs are identical in every case. Existing official-corpus tests still pass; they do not cover this matrix.

This is not introduced or fixed by the performance commit. Do not add tests that canonize the extra spaces. The finding provides a concrete next architecture question: structural tab expansion and literal fenced-content projection currently share one operation. Investigate that ownership boundary while preserving math's source-line-ending behavior and incremental equality semantics.

All frozen bundles, source variants, scripts, 32 CPU profiles, JIT logs and original observations are recoverable from `logical-line-projection-b27a41d-node26-m1pro.json`. Four earlier unadmitted source edits remain unchanged and excluded from the admission comparisons.
