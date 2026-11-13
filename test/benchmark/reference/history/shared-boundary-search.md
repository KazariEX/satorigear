# Shared inline boundary discovery: implementation and disposition

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Neither candidate is retained. Production is restored to source `2c1b10c`, records base `ed768b4`, and the exact 161,093 B baseline bundle (SHA-256 `647a800e21901ec1455291689ca40e330115d43ddb15946efffc118d2e759f64`). No new remark ratio is measured; the 100× goal remains unmet.

This implements the previously unmeasured possibility in [inline input bounds](inline-source-bounds.md). It preserves bounded scanner input and tests sharing only native boundary discovery. It does not repeat the rejected whole-source scanner, line-layout or direct-AST rewrites.

## Ownership and model changes

Each parse/update creates one `InlineBoundarySearch`, holding the current complete source, the start of its last search and its next result. It reuses a result only within the already-searched interval; backward requests restart discovery. A miss is represented by the current source length. The search object's lifetime ends with the parse/update; neither retained regions nor profiles own it.

Contiguous SourceViews expose their current source origin. The tokenizer searches the original source, clips the answer to the local region, and still passes the original bounded local string to syntax scanners. Segmented views use the original local search. Retained regions continue to preserve their own text and shift only mapping coordinates. Changed regions receive the current update's search object; definition-only invalidation reuses raw tokens without tokenizing again.

Six files change in the prototypes: `inline/tokenize.ts`, `source-view.ts`, `fragment/block.ts`, `fragment/inline.ts`, `inline/region.ts`, and `document.ts`. No feature scanner signature or public parser API changes. However, this **adds** a search state, a SourceView getter and parameters through region/update/build code. It does not remove local strings or a token model.

- **B:** consults the shared search for every contiguous-region boundary lookup. Bundle **162,064 B**, +971 B.
- **C:** after B's regression and runtime investigation, consults it only at region entry. Subsequent queries use the original stateless local helper. Bundle **162,239 B**, +1,146 B.

C moves cross-region knowledge out of the intra-region loop, but loses some lookahead reuse from the previous region's final search. Both exceed the no-growth requirement. Neither is admitted on query counts or code appearance.

## Actual executed work

Both backends on Node 26 produce identical counters and complete AST/positions. Per variant/backend, 1,318 instrumented public parses, each compared with the uninstrumented baseline, cover the corpora and four additional source families. Every shared result is also checked against the original bounded regex result before parsing consumes it.

| Input | Native queries A | B | C | Shared requests B → C |
| --- | ---: | ---: | ---: | ---: |
| spec | 2,300 | 2,076 | 2,207 | 1,894 → 732 |
| examples | 1,531 | 1,459 | 1,472 | 1,489 → 699 |
| Rust | 26,553 | 25,737 | 25,916 | 18,081 → 6,108 |
| APIs | 10,906 | 4,828 | 4,914 | 10,906 → 8,775 |
| 800 plain paragraphs | 800 | 1 | 1 | 800 → 800 |
| projected paragraphs | 800 | 800 | 800 | 0 → 0 |

Fewer invocations do not imply less matching work. For the plain family, the summed logical search span grows from 8,800 to 10,400 code units. The old local inputs contain no LF; the shared search interval contains **1,600 LFs**, including paragraph separators outside every inline region. Spec LF occurrences in the queried spans similarly change from 1,138 to 2,605 in B / 2,052 in C. These are characters in actual requested spans, **not native comparisons, backtracking counts or allocated bytes**. Repeatedly searched characters count repeatedly.

## Controlled throughput and a runtime-selection mistake

All runs use `taskpolicy -c utility`, fresh processes/modules, alternating ABBA/BAAB, 250 ms warmup, full GC, 150 ms settling, and approximately 300 ms measured including natural GC. Every phase is capped at 500 ms. Own builds, tests and profiles do not overlap throughput.

The initial shell's `node` was **24.22.1**, despite the intended Node 26 baseline. This was a missed environment check. The report metadata exposed it; all 240 Node 24 observations are preserved and labeled separately. They are valid same-runtime A/B comparisons but cannot stand in for Node 26 results. Follow-up uses the absolute Node **26.13.0** executable. All results are from Apple M1 Pro, not M3. No observations from the two runtimes are pooled.

Positive means slower. Each row has four complete alternating blocks and a Student t interval on paired block log ratios.

| Node 26 workload | A → B | 95% interval | A → C | 95% interval |
| --- | ---: | --- | ---: | --- |
| spec | +2.01% | +0.64% to +3.39% | +1.84% | +0.85% to +2.84% |
| examples | +3.26% | +1.78% to +4.77% | +1.93% | +0.21% to +3.67% |
| plain paragraphs | +9.94% | +8.69% to +11.20% | +9.54% | +9.16% to +9.92% |

Node 26 has 96 normal observations. Its established regressions already block admission; broader Node 24 results are not transferred to Node 26 as equivalence claims.

| Node 24 workload | A → B | 95% interval | A → C | 95% interval |
| --- | ---: | --- | ---: | --- |
| spec | +1.93% | +0.61% to +3.27% | +2.55% | +1.79% to +3.33% |
| examples | +1.77% | +1.44% to +2.10% | +0.90% | +0.17% to +1.64% |
| Rust | −0.50% | −1.59% to +0.60% | −0.06% | −1.82% to +1.74% |
| APIs | −2.41% | −12.06% to +8.31% | −6.00% | −19.64% to +9.95% |
| document/spec | +3.61% | −1.73% to +9.24% | +2.46% | −1.92% to +7.04% |
| tail edit | +0.82% | −1.08% to +2.75% | not measured | — |
| plain paragraphs | +4.97% | +4.52% to +5.42% | +5.13% | +4.72% to +5.54% |
| projected paragraphs | +0.86% | −3.13% to +5.03% | not measured | — |
| long opaque code body | +0.59% | +0.34% to +0.85% | not measured | — |

Wide API intervals do not establish a benefit. Separate A/B and A/C comparisons are not an exact causal B/C decomposition. Across all 336 normal observations, the longest measured window is 299.285 ms.

## Runtime investigation and adjustment

Independent CPU/GC/JIT diagnostics were run on Node 24 (B/spec, B/plain, C/spec) and Node 26 (C/spec, C/plain). Each CPU group has four ABBA/BAAB blocks. The entry-only C adjustment follows B's source counts and profiles; it is not a fresh unrelated optimization.

On Node 24, B/plain changes boundary-helper self samples from about 8.12 μs/operation to 18.91 μs in `find`, while observed GC decreases from 4.14 to 3.58 μs. V8 logs show `find` inlined into the boundary helper/generated tokenizer. Thus an explanation based only on a missed function inline or extra GC is not supported.

The Node 26 C/plain profiles corroborate the concentrated cost: baseline boundary-helper samples are about **9.71 μs**; C has **18.74 μs in `find` plus 1.17 μs in its entry helper**. Observed GC is 3.08 → 3.06 μs per operation. No measured bailout/invalidation or optimization completion appears in those plain JIT traces. These are diagnostic sampled locations, not an exact additive decomposition.

Spec is less resolved: Node 26 aggregate boundary-related self samples are about 98.04 μs in A versus 95.08 μs in C, despite the measured overall regression. Samples move among unchanged block/projection routines too. There are zero measured bailouts/invalidations, but six/eight measured optimization completions in A/C; global JIT quiescence is not established. The pure-paragraph explanation must not be promoted to an exact explanation of spec's 1.84% change.

### Isolating the expanded native search

A separate, explicitly diagnostic counterfactual retains C's object, cache checks, clipping and parse/build path, but tests the empty string instead of the complete source at its known unsuccessful native search. It is valid **only** for the fixed `plain words\n\n` family, whose boundary search is already known to miss. Full public AST/positions match A/C at 100, 200, 400 and 800 paragraphs, with both default/full profiles and both tokenizer backends.

On Node 26, four ABBA/BAAB blocks comparing C to this counterfactual give **−15.65%, CI [−16.22%, −15.07%]**. The additional 16 observations are marked diagnostic, not counted among normal candidate observations. The harness refuses other workloads. This supports a substantial cost in the enlarged native search even though it executes only once per parse. It does not distinguish every regex-internal operation, prove that all the cost is LF handling, or provide a usable optimization: general parsing cannot assume the input contains no markers. It is never installed in production. No separate ratios are multiplied to manufacture a baseline gain.

The result corrects the narrower initial suspicion that cache checks alone explained the regression. Sharing discovery both adds control state and changes what the matcher must search. Moving cache access to entry addresses only the former.

## Validation, diagnostic failures and retained state

Both variants pass the corpus/full-AST and edit validators under generated and forced-CSP backends on Node 24 and again on Node 26. Each backend includes 2,614 corpus comparisons, 612 definition-related documents / 4,284 edits, 4,608 feature edits, earlier syntax/delimiter guards and 18 prefix/suffix documents / 36 edits. Feature random edits compare incremental versus fresh trees; they are not mislabeled as an independent baseline oracle. Both candidates pass build/typecheck and 198 existing tests on Node 24; C also passes all 198 on Node 26. No parser-private repository test is added.

Two diagnostic setup issues are preserved:

1. The first profile summarizer required V8's profile start timestamp to fall exactly inside the `hrtime` call bracket. Some Node 24 starts precede it by 2–11 μs. Raw profiles are unchanged. The new summary records every discrepancy, verifies that the measurement is covered by the profile, clips samples to the actual measurement, and includes ±100 μs boundary sensitivity. This sensitivity is not a proof of cross-clock precision. It does not affect the unprofiled throughput clock or its results.
2. The counterfactual harness initially validated the coordinator's `--cases` option in workers, whose workload arrives positionally. It failed before any observation. The corrected guard checks the actual worker workload. The failed report/log are retained; it was not a timed sample or a live worker restarted on timeout.

All six production files were restored only after their current bytes matched the frozen C snapshot. The rebuilt dist is byte-identical to A. Only the consolidated records commit is amended; no source/revert commit, worktree or push is created. Frozen A/B/C bundles, both six-file patches, source snapshots, all observations, Node 26 validation outputs, probes, raw V8 logs/profiles and the restricted counterfactual are embedded with hashes in `shared-boundary-search-ed768b4-m1pro.json`. The successful C/Node 24 validator output filenames were reused during Node 26 validation; they are not presented as an independently preserved historical log set. Separate unit-test logs for both runtimes remain available.

Do not retry either shared-cursor implementation merely because it reduces regex calls. A future proposal needs a changed premise that avoids searching excluded inter-region content and accounts for the additional source-coordinate/lifetime contract without growing the model. This experiment does not reject architectural evolution or all boundary sharing; it closes these two concrete designs and the claim that query-count reduction alone predicts their benefit.
