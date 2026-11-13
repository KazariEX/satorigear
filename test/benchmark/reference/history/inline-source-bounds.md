# Inline input bounds and shared boundary discovery

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Follow-up: [shared boundary search](shared-boundary-search.md) implements the candidate described below. Both the per-query and entry-only cursors regress on Node 26 and grow the bundle; both are withdrawn after runtime attribution and an adjustment. The "unimplemented" statements below describe this earlier screen, not the current disposition.

This is a feasibility and ownership screen on accepted source `b208563`, records base `c55f623`. Production and the 161,137 B bundle are unchanged. There is no new throughput comparison, source candidate, speedup or remark multiplier. The 100× goal remains unmet.

The previous [source projection screen](source-projection-boundaries.md) distinguished bounded inline input from block-row state and found that many contiguous strings borrowed backing storage rather than copying their contents. This follow-up tests the actual lexical boundary contract, the work exposed by removing local bounds, and the lifetime of a possible shared search result. It does not repeat the rejected regex, row-layout or direct-AST implementations.

## Runtime reason to inspect this boundary

Eight existing candidate spec CPU records from `delimiter-search-bounds-bfa6c71-node26-m1pro.json` have the exact current bundle hash, `f66c3a4f9f17b5c2a34b4e67b8ac0bb738cf24bfd24933d0e0b008db91cecc75`. Their aggregate `nextBoundaryOffset` self samples are approximately 102.56 μs per parse. The records, source archive hash and summary are identified in this screen's archive; no CPU processes are rerun.

That sample share is not an upper bound on achievable savings and is not a promise that eliminating helper calls would recover it. Regex work, inlining and sampling aliasing remain relevant. The rejected inline-regex variants already demonstrate that a shorter expression can do more matching work.

## Bounded strings carry grammar semantics

Frozen-bundle hooks observe each SourceView publication and actual native boundary/scanner invocation through public parse calls. The real parser still receives its original local string. Separate hypothetical calls pass the complete original source with an adjusted start; their results are recorded but never consumed by parsing. Instrumented complete AST/positions equal the uninstrumented baseline.

Removing the local string without replacing its bound changes scanner behavior:

| Public syntax | Local inline range | Actual local backtick scanner end | Hypothetical original-source end |
| --- | --- | ---: | ---: |
| `# ` followed by `` `a\n\nb`\n `` | offsets [2, 4) | offset 3 | offset 8 |
| `` `a\n\nb`\n `` | first paragraph | unmatched opening run | consumes a later paragraph's closing backtick |
| table source `` a \| `b\n-- \| --\nx \| c`\n `` | header cell [4, 6) | offset 5 | offset 21 |

The first table's scanner result is converted to original-source coordinates for comparison. These are scanner consumption endpoints, not AST endpoints. Across stock inputs, six official-example scanner calls and four Rust scanner calls cross their region boundary in the hypothetical invocation. Spec/APIs happen to have none; their absence is not a grammar proof.

Heading/paragraph backtick witnesses and a heading ending in a backslash match the reference parser's full AST/positions. A projected blockquote witness has equal semantic trees but exposes an inherited end-position difference: baseline blockquote ends at offset 12, reference at 11. The initial failing oracle script/log and both complete trees are preserved. It is neither introduced by this screen nor added to repository tests as expected behavior.

Consequently, simply deleting slices and adding an origin offset is not an equivalent scanner contract. A proper bounded-source design would have to account for code-span lookahead, escapes at the end of a region, other scanners, resolution and segmented input. This does not reject every possible bounded-source architecture.

## Native searches can also repeat outside their region

The native regex has no end-bound argument. Hypothetical full-source searches are counted separately from actual bounded searches. Distances below are logical code-unit spans from the requested offset to the result/EOF, **not native character comparisons, allocated bytes or measured time**.

For `plain words\n\n` repeated N times:

| Paragraphs | Current bounded queries | Current logical span sum | Uncached full-source span sum |
| --- | ---: | ---: | ---: |
| 100 | 100 | 1,100 | 65,650 |
| 200 | 200 | 2,200 | 261,300 |
| 400 | 400 | 4,400 | 1,042,600 |
| 800 | 800 | 8,800 | 4,165,200 |

Every bounded query finds no marker. Without preserving cross-region knowledge, every full-source query independently searches the remaining suffix. This gives quadratic logical search-span growth even though the original parser does linear bounded discovery. No throughput regression percentage is inferred.

## A distinct possibility: share discovery, retain bounded syntax input

A second diagnostic simulates retaining one next-boundary result across contiguous regions. It reuses the result when the requested offset remains within the range already searched, including a known miss to EOF. Backward requests would reset that proof. It clips the returned boundary to the current region and asserts equality with the original bounded helper result. Segmented regions continue to use their original local text in this simulation.

| Corpus | Actual native queries in contiguous regions | Hypothetical shared queries | Bounded span sum | Shared span sum |
| --- | ---: | ---: | ---: | ---: |
| spec | 1,894 | 1,670 | 82,821 | 86,177 |
| examples | 1,489 | 1,417 | 5,135 | 5,996 |
| Rust | 18,081 | 17,265 | 182,340 | 199,834 |
| APIs | 10,906 | 4,828 | 125,985 | 149,089 |

Spec additionally has 406 segmented-region native queries, unchanged by this simulation: its total query reduction would be 224 out of 2,300, not 224 out of 1,894 for the complete lexer. Rust additionally has 8,472 segmented queries. For the pure paragraph family, the shared simulation needs one full-source query, with span 13N, removing the hypothetical repeated suffix searches.

No backward original-source query is observed in the tested contiguous regions. This is an observed ordering property of tokenizer discovery, distinct from SourceView mapping calls, which are not generally monotonic. It is not a proof about every feature or future builder order.

The tradeoff is explicit: fewer native invocations, longer searched spans, state checks on each lookup, plus a current-source owner. Scanner semantics still depend on bounded local strings; this simulation does not remove slices or segmented concatenation. It also does not provide a production implementation, bundle-size result or throughput estimate. Do not equate query-count reduction with speedup.

## Incremental ownership constraint

An independent public edit probe observes SourceView construction and shifting. Four documents across two profiles undergo eight prefix insertion/undo edits. Both tokenizer backends produce the same 32 shift events, including 28 contiguous-view shifts. Incremental AST/positions equal both baseline and fresh parsing after every edit.

Fourteen of those contiguous shifts would read the wrong text if the view retained its original complete source and searched it at the newly mapped coordinates. For example, the retained text `` `one` `` moves to [14, 19); that span in the old source contains `*two*`. Reading the current document source at those coordinates still gives the correct text.

Current SourceView semantics intentionally separate stable logical text from current mapped coordinates. A shared full-source search cursor therefore cannot simply be attached to a retained region and shifted with its map. It needs a parse/update-local source owner, or a separately defined immutable source revision and coordinate system. The latter adds another lifetime/coordinate contract and must justify that cost. No such protocol is added here.

## Decision and reproducibility

Keep bounded scanner input in production. Do not mechanically remove local strings, install a full-source cache on retained SourceView, or repeat the previously rejected boundary expressions. Shared boundary discovery remains an **unimplemented, unmeasured** candidate; it has not been performance-rejected. Before implementation, specify its parse/update-local owner, its relation to segmented views, and how it replaces existing work without spreading source ownership across features.

Each backend completes 664 full AST/position comparisons for the boundary probes, plus four documents/eight incremental edits for the ownership probe. Three unprojected reference sources match complete AST/positions; the fourth projected source matches semantics with the recorded inherited position discrepancy. There are no new parser-private repository tests and no production API changes.

All probe/validation executions use `taskpolicy -c utility`, Node 26.13.0 on M1 Pro. The original and shared probes, failed oracle attempt, corrected scoped oracle report, frozen bundle/source, raw counters and provenance of reused V8 profiles are archived in `inline-source-bounds-c55f623-node26-m1pro.json`. No new timing process is run, so this record has no new ABBA/BAAB result to claim. Only the trailing consolidated-record commit is amended.
