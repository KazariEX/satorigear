# Full-delimiter literal search for code-span closures

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

**No candidate is retained.** Accepted source remains `7692fbb`; production `code.ts` and its rebuilt 160,838 B bundle are restored byte-for-byte. This experiment does not establish a spec gain or a new remark ratio. The 100× objective is unmet; the user requested pausing the goal after this candidate's disposition.

## Hypothesis and model

The baseline searches for the next single backtick, counts the whole run, then compares its length with the opener. Candidate B instead searches for the complete opening delimiter string. A hit already proves the minimum length; a following backtick rejects an overlong run, which is consumed before the next search. Shorter runs never become JavaScript candidates.

Only `packages/satorigear/src/profile/features/code.ts` changes. No cache, scanner context, feature API, token field, source coordinate, projection, incremental ownership or codegen/CSP path is added. Opening-run consumption and the escaped-prefix guard remain intact. The marker string itself supplies its length; a preliminary draft retained a redundant numeric length alias and was built but never timed.

This differs from the closed whole-span/backreference regex and same-marker regex routes in [inline recognition](inline-recognition-research.md), and from the unimplemented per-region backtick-length cache. It retains literal native search, but changes its needle from one character to the complete delimiter. The route index, Markdown studies and structured JSON descriptions were screened before implementation. This is a focused search-algorithm experiment, not a replacement of the parser architecture.

| Variant | Search/validation | Raw bundle | gzip-9 |
| --- | --- | ---: | ---: |
| A | Single backtick search, complete run count, original loop | 160,838 B | 33,487 B |
| Untimed draft | Full delimiter plus redundant numeric length alias | 160,868 B | 33,493 B |
| B | Full delimiter search, trailing-character validation | 160,828 B | 33,487 B |
| C, attribution control | Retain B's delimiter string and search-loop shape; restore single-backtick search and complete run counting | 160,807 B | 33,483 B |

C is an isolation control, not an admitted optimization. It intentionally retains a marker string that its restored search no longer needs. It has no direct A/C throughput comparison or broad performance admission. No independent new optimization was started after the user's pause request.

## Executed work

Instrumented generated/CSP runs compare their full ASTs/positions with the corresponding uninstrumented bundles and compare entire raw numeric token vectors between A/B. All agree. Counts are source-level work, not native character comparisons, allocated bytes or instruction costs.

| Input | Search calls A → B | Candidate runs A → B | Closing run-helper calls A → B |
| --- | ---: | ---: | ---: |
| spec | 519 → 513 | 519 → 513 | 519 → 0 |
| Rust | 7,305 → 7,304 | 7,300 → 7,298 | 7,300 → 0 |
| APIs | 884 → 884 | 884 → 884 | 884 → 0 |
| 652 CommonMark examples | 46 → 53 | 42 → 38 | 42 → 5 |
| Long literal body | 1 → 1 | 1 → 1 | 1 → 0 |
| Unclosed long body | 1 → 1 | 0 → 0 | 0 → 0 |
| 800 overlong runs | 801 → 801 | 801 → 801 | 801 → 800 |
| 2,400 shorter runs | 2,401 → 1 | 2,401 → 1 | 2,401 → 0 |
| 64 descending run lengths | 2,080 → 64 | 2,016 → 0 | 2,016 → 0 |

The extra example searches arise from B querying for another hit even when an opener/overlong run reaches EOF, whereas A's source-length loop could exit first. They are not hidden by counting only successful matches. Long-body and descending-run cases above are correctness/work probes, **not throughput results**.

## Strict throughput and attribution

Node **26.13.0**, absolute executable, **Apple M1 Pro**, `taskpolicy -c utility`; not an M3 replication. Four alternating ABBA/BAAB blocks per case, fresh process/module per observation, 250 ms warmup, full GC, 150 ms settling, natural GC inside approximately 300 ms measurement, 500 ms cap. No own build, tests, analysis scripts or profiles overlap throughput. All **80 unprofiled observations** are retained. Positive means slower.

| Comparison | Input | Elapsed change | 95% CI |
| --- | --- | ---: | --- |
| A → B | spec | +0.09% | [−1.89%, +2.11%] |
| A → B | examples | −0.47% | [−1.52%, +0.59%] |
| A → B | 2,400 shorter runs | **+21.16%** | **[+19.63%, +22.70%]** |
| A → B | 800 overlong runs | **−7.45%** | **[−8.40%, −6.50%]** |
| B → C | 2,400 shorter runs | **−20.81%** | **[−21.82%, −19.79%]** |

The two sources are:

```js
const shorterRuns = "lead ````" + "word ` and `` and ``` repeated ".repeat(800) + "```` tail\n";
const overlongRuns = "lead `" + "word `` repeated ".repeat(800) + "` tail\n";
```

Both use the normal six-feature benchmark configuration and public parse/AST output consumption.

The presumed favorable shorter-run case actually regresses despite eliminating 2,400 JavaScript candidate checks. It was investigated before rejection:

- Four ABBA/BAAB CPU diagnostic blocks on the exact shorter-run workload give approximately **38.99 → 46.86 μs/parse**. Observed GC is **0.054 → 0.050 μs/parse**, not an amplification commensurate with the slowdown.
- Named `scan` self samples rise **22.16 → 44.72 μs/parse**, while `inlineMarkerRunEnd` falls **11.88 → 0.02 μs/parse**. The cost moves into the scanner/search path. Names are aggregated and inlining can move attribution; these are not exact additive instruction costs or proof of a particular native search implementation.
- Phase-tagged JIT logs record **11 / 8 optimization completions during measurement**, with no measured bailout/invalidation. They do not establish JIT quiescence. Raw logs, profiles, clock audits and ±100 μs clipping sensitivity are preserved.
- C keeps the marker substring allocation and the loop shape but restores the old search/validation strategy. Its direct **20.81% improvement over B** supports attributing the adverse tradeoff to the full-delimiter search/validation strategy, rather than simply marker-string allocation or GC. It does not isolate one instruction, prove the exact internal matching algorithm, or establish an A/C gain. Independent percentages are not subtracted or multiplied to invent one.

The overlong-run benefit does not offset the shorter-run regression. No delimiter-length threshold, corpus heuristic, dual search policy or hidden cache was added to rescue the candidate. Broad Rust/API/edit throughput and CSP throughput were not run after this clear guard failure; their runtime counters and correctness checks are not performance admission.

## Correctness, restoration and records

B passes build, typecheck, changed-file lint and all **198 existing tests**. Each generated/CSP backend additionally passes the twelve existing differential jobs: 2,614 corpus AST/position comparisons, 4,608 feature edits, 612 definition documents / 4,284 edits, previous public syntax guards and 3,072 indented-code documents / 6,144 edits. A code-span-specific differential matrix passes **5,400 syntax documents and 600 edits per backend**, including complete tree checks after insertions and their removals, against baseline and fresh parse. C passes the code-span matrix and its 2,614 corpus comparisons in each backend; it has no claim to B's entire validation suite. No parser-private repository tests are added.

The source restoration build reproduces baseline SHA-256 `cb48a7a3f3bf1cd62b4c3ab009dede544560c3776c77a017105a4c28f8b33107`. The canonical B/C bundles, patches and source snapshots remain only in the experiment archive. All reports, scripts, runtime probes and raw measurements are embedded in `code-closer-b3cbe5a-node26-m1pro.json`. Only the trailing consolidated records commit is amended; no optimization commit, revert, worktree switch or push occurs.

Do not retry complete-delimiter `indexOf` merely because it reduces JavaScript calls. A future proposal must account for native matching cost on short-run-dense input, preserve the escaped-run guard and raw token stream, and justify any added state or alternative search path. The current candidate is closed after runtime attribution and a controlled strategy adjustment.
