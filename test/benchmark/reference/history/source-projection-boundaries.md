# Source projection: semantic boundary and actual string materialization

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

This is an architectural feasibility and runtime-layout screen, not an admitted optimization. Production remains unchanged at source tree `c7b3facdda5b13409a0822025d48c1a00e38b5e5`, baseline record commit `a298353`, bundle SHA-256 `c98a3b1976e99d0d26cf3b64557fa8f6292b17c1ce28198bda2682508e9d2d38` (161,643 B). No new throughput comparison or remark ratio is claimed; the 100× goal remains unmet.

## Can existing SourceView replace container row projections?

The existing SourceView projects text and maps offsets. BlockLines projections also preserve lazy-continuation eligibility and virtual indentation left after consuming part of a tab. Public syntax counterexamples show that these are semantic facts, not redundant coordinate caches:

| Inputs (escaped line endings/tabs) | Equal projected row text | Distinguishing fact | Result inside quote |
| --- | --- | --- | --- |
| `> a\n===` / `> a\n> ===` | `a\n===` | second row lazy / explicit | paragraph / level-one heading |
| `>\t  foo` / `>   foo` | `  foo` | virtual prefix columns 2 / 0 | code / paragraph |

The heading distinction also holds with CRLF and CR. The local CommonMark specification explicitly forbids a lazy continuation line from acting as a setext underline (`test/corpus/commonmark-spec.md`, lines 1513–1539). Hyphen-underlined cases are controls, not equal-projection examples: an unquoted `---` becomes a root thematic break.

Generated and forced-CSP runs each check 14 sources. Every instrumented full AST, including positions, equals the uninstrumented baseline. Tab examples' semantic ASTs agree with the raw reference. Heading/ending cases compare semantic ASTs to an explicitly LF-canonical reference; the initial raw-reference check failed because the parser normalizes paragraph line endings while the raw reference retains CRLF. The failed script and failure report remain archived. This is not a claim of raw-reference equality on non-LF inputs.

This rules out simply deleting row state and feeding the concatenated text into the existing block parser. It does **not** rule out every SourceView-based design: a consumer with original-source access could reconstruct container facts, or a new view could carry them. Those alternatives need explicit ownership and cost accounting. Materializing virtual spaces also changes mapping requirements; the existing unit-slope segments do not independently encode virtual columns.

## Would bounded inline scanning eliminate a large string copy?

A separate probe captures every SourceView text publication through public parse calls. All 655 stock documents per backend compare full AST/positions against baseline. Rust/APIs use the benchmark's six-feature profile; spec/examples use the default profile.

| Corpus | Contiguous views | Contiguous UTF-16 units | Segmented views | Segmented UTF-16 units |
| --- | ---: | ---: | ---: | ---: |
| spec | 732 | 86,158 | 82 | 17,140 |
| Rust | 6,108 | 415,990 | 1,366 | 217,294 |
| APIs | 8,775 | 200,816 | 0 | 0 |
| examples | 699 | 7,432 | 26 | 392 |

These are publications and string lengths, not allocated bytes or unique heap objects. Existing within-parse SourceView reuse is retained.

Node 26.13.0 / M1 Pro V8 `%DebugPrint` inspects **all 814 spec publications** in both backends. A second pair of runs logs immediately at publication, before tokenization, rather than after the parse. Per-publication layouts agree across all four runs:

| Actual V8 string representation | Publications | UTF-16 units |
| --- | ---: | ---: |
| Contiguous `SLICED_TWO_BYTE_STRING_TYPE` | 689 | 85,799 |
| Contiguous `SEQ_ONE_BYTE_STRING_TYPE` | 43 | 359 |
| Segmented `SEQ_TWO_BYTE_STRING_TYPE` | 82 | 17,140 |

Therefore, treating all 86,158 contiguous units as a character buffer copied by SourceView is wrong for this runtime/input. Most contiguous strings are already slices borrowing backing storage. A bounded-source lexer could still remove slice objects or coordinate work; this screen does not measure that potential gain. Segmented projection has genuine concatenation and mapping work, but scanners can match syntax across those gaps, so deleting the concatenation requires a different input contract, not just removing `join`.

No universal string-length threshold or layout guarantee is inferred from these observations. Keeping strings for diagnostics changes retention; these probes are not heap-allocation or throughput measurements.

## Existing CPU evidence, reused rather than retimed

The prior raw-token-retention archive contains eight baseline spec CPU observations whose bundle hash is exactly the current hash. Reanalysis of their 2,503 parses, clipping samples to their recorded measurement windows, finds these named SourceView stacks:

| Sampled self time | μs / parse |
| --- | ---: |
| `reset` | 14.92 |
| `containingSegment` | 8.01 |
| `mapOffset` | 4.56 |
| `mapEnd` | 1.76 |
| Total | 29.25 |

The union of those stacks including descendants is 29.61 μs/parse. These are sampling diagnostics, not an upper bound on achievable savings: inlined operations can be charged to callers and GC is separate. Exact profile names/hashes and the analysis script are preserved; the original profiles remain in `raw-token-retention-67e5022-node26-m1pro.json`. No new performance process was needed.

## Decision and research boundary

Do not implement a text-only replacement for block row projections: it loses proved semantics. Keep that constraint separate from the later inline stage, where block interpretation is already settled.

The bounded-inline-source direction remains **unimplemented and unmeasured**, not a rejected performance candidate. Its premise must be slice-object/coordinate elimination or avoidance of segmented concatenation, not copying all contiguous text. Before expanding scanner signatures, account for searches and regular expressions crossing region bounds, matches spanning source gaps, and retained incremental regions. A fallback that duplicates complete lexer paths would need to justify the added model and bundle cost.

Follow-up: [inline input bounds](inline-source-bounds.md) records actual scanner crossings, repeated unbounded search spans, a hypothetical shared-boundary query reduction, and retained-region shift counterexamples. It preserves bounded syntax input and requires parse/update-local ownership for any shared discovery state; it adds no performance claim or production implementation.

Historical compressed/lazy physical indexes, direct-AST ownership protocols, and segmented mapping's non-monotonic call-order issue were reviewed and not reimplemented. This screen adds semantic counterexamples and actual V8 string layouts; it does not overturn their separate results.

All probe executions use `taskpolicy -c utility`. There are zero new throughput observations, no source candidate, no parser-private tests, and no parser/bundle changes. Frozen bundles, probe scripts, reports, raw V8 logs, normative excerpt and hashes are embedded in `source-projection-boundaries-a298353-node26-m1pro.json`. Only the trailing consolidated record commit is amended.
