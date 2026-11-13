# Link delimiter runs directly

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Retained source commit: `821f17d` — `perf: link delimiter runs directly`.

This removes the delimiter run array and numeric links while preserving the pairing algorithm. Combined default-protocol time decreases **10.28%** on a formatting-heavy guard and **36.14%** on a mixed-delimiter mismatch guard. Spec changes −0.10%, CI [−0.55%, +0.36%]: no established spec gain. No new remark reference was measured; the 100× goal remains unmet.

Only `packages/satorigear/src/inline/delimiter.ts` and `packages/satorigear/src/profile/resolve.ts` change: 55 lines added / 54 removed. The unminified bundle decreases from 161,371 to 161,149 B (−222 B). There is no added feature API, parser pass, token format or persistent cache. Generated and CSP tokenizers are unchanged.

## Representation and scope ownership

Previously each run object stored numeric `previous`/`next` links into a separate array. The resolver kept that array plus its active length, and each bracket frame checkpointed a numeric prefix length. Scope resolution converted indices back to objects for traversal and unlinking. Closed suffix slots could be overwritten by later runs.

Now runs point directly to their neighbors. The resolver keeps the first and last active run. Each frame's `delimiterBottom` identifies the last run outside its delimiter scope, replacing `delimiterStart`. Closing a scope detaches the suffix after that node, resolves it and restores the saved tail. An undefined boundary means the scope owns the whole current chain. Matching failure bounds also store run identities instead of array indices.

The boundary must remain in the unchanged active prefix until that scope closes. Scope resolution operates only on the detached suffix, so its destructive matching cannot mutate the saved prefix. Appending runs extends the active tail. Raw and semantic bracket topology remain distinct: successful links select their semantic frame's checkpoint; feature-owned closures select their own frame's checkpoint. The existing feature visibility/consumption rules are preserved.

A feasibility probe checked both numeric prefix length and actual checkpoint object identity before editing production. Across 54,092 documents per backend it observes 44,590 scope closures: 37,841 empty, 6,749 nonempty, zero checkpoints above the active length and zero checkpoint objects replaced by slot reuse. The corpus includes official examples, crossed reference-label/code-span cases, seeded mixed delimiter/bracket inputs and four feature profiles. These observations corroborate the scope audit, not a proof of arbitrary future grammar changes.

Frames and runs still have resolution-local lifetime. Direct links may form cycles and change pointer reachability, but no objects escape into ASTs, resolved tokens or edit caches. Replacement ranges and raw/resolved streams remain unchanged. This is not the rejected lazy workspace allocation or packed numeric replacement experiment.

## Work counts and runtime layouts

Instrumented public parses match baseline full AST/positions. Generated and forced-CSP counts agree:

| Input | Runs, both | Run arrays, A → B | Resolved scopes, both |
| --- | ---: | ---: | ---: |
| spec | 206 | 48 → 0 | 48 |
| Rust | 123 | 70 → 0 | 70 |
| APIs | 104 | 52 → 0 | 52 |
| formatting guard | 3,200 | 1 → 0 | 1 |
| nested scopes guard | 1,600 | 1 → 0 | 401 |
| mismatch guard | 3,200 | 1 → 0 | 1 |

V8 `%DebugPrint` after resolution shows 80 B / seven in-object properties for runs in both versions, and 112 B / eleven properties for bracket frames. Eight inspected mixed runs share one map within each variant/backend cohort. The inspected nonempty failure-bound array changes from `HOLEY_SMI_ELEMENTS` to `HOLEY_ELEMENTS`; it still exists. Removing the run array does not establish identical pointer scanning, universally lower GC, or exact allocated-byte savings.

Search work is unchanged, including difficult inputs:

| Input | Closer visits, A = B | Opener visits, A = B | Pair checks, A = B |
| --- | ---: | ---: | ---: |
| spec | 206 | 103 | 103 |
| Rust | 123 | 45 | 45 |
| formatting | 3,600 | 2,000 | 2,000 |
| mismatch | 4,000 | 323,600 | 2,400 |

These are source-operation counts, not machine instructions. They rule out attributing this candidate's gains to fewer pairing/search steps on those inputs.

## Strict throughput comparison

Node 26.13.0 / Apple M1 Pro, `taskpolicy -c utility`, independent process/module for each observation, alternating ABBA/BAAB, 250 ms warmup, explicit full GC, 150 ms settling and about 300 ms measured with natural GC included. Every phase is capped at 500 ms. No own builds, tests or profiles overlap throughput. These are not M3 measurements.

All initial four blocks and independent eight-block confirmations are retained. Twelve-block rows combine paired block log ratios with Student t(11); four-block rows use t(3). Positive values are slower.

| Workload | Blocks | Change | 95% interval |
| --- | ---: | ---: | --- |
| spec | 12 | −0.10% | −0.55% to +0.36% |
| examples | 4 | −0.28% | −1.17% to +0.62% |
| Rust | 12 | +0.32% | −0.48% to +1.14% |
| APIs | 12 | +0.35% | −0.20% to +0.91% |
| document/spec | 4 | +0.10% | −1.14% to +1.36% |
| tail edit | 4 | −0.39% | −1.83% to +1.08% |
| formatting guard | 12 | −10.28% | −13.64% to −6.78% |
| nested delimiter scopes | 4 | −0.68% | −1.72% to +0.37% |
| mismatch guard | 12 | −36.14% | −36.50% to −35.78% |
| definition availability edit | 4 | −3.50% | −5.30% to −1.67% |

Spec observation means are 908.520 → 907.656 μs. Initial spec was +0.19%, confirmation −0.24%. Formatting was −14.11% initially and −8.30% in confirmation; mismatch −36.48% and −35.97%. Initial Rust +0.54% and APIs +0.84% prompted runtime investigation and independent confirmation (+0.22% and +0.11%). No observation was excluded.

## CPU, GC and JIT attribution

Separate four-block CPU diagnostics use the same fresh-process and phase protocol. They are attribution evidence, not throughput admission:

- **Mismatch:** elapsed approximately 2,415 → 1,551 μs; `resolveDelimiterScope` self samples approximately 1,861 → 1,001 μs. Observed GC per parse changes only 32.68 → 31.03 μs. Together with identical search counts, this supports cheaper execution of the matching traversal after representation replacement. It does not identify exact bounds checks, machine instructions or cache effects.
- **Formatting:** elapsed approximately 587.62 → 532.60 μs; observed GC 59.40 → 41.20 μs. Matching self samples are approximately 37.96 → 38.05 μs, so the improvement is not simply the matching loop becoming faster on every input. Default unprofiled GC is 62.09 → 39.65 μs. Allocation/lifetime effects are consistent with part of the gain, but the samples do not yield an exact decomposition.
- **Rust:** elapsed approximately 12,726.72 → 12,619.75 μs, opposite the small adverse unprofiled direction; observed GC 1,393.62 → 1,384.56 μs. Source probes find only 123 runs / 70 removable arrays. Neither these counts nor shifted samples among unchanged routines identify a candidate-specific regression cause.

Inspected measurement traces contain no bailout or dependent-code invalidation for any of these three workloads. Rust has seven versus eight optimization completions during measurement; formatting zero versus one; mismatch zero versus zero. This does not establish global JIT quiescence.

GC trace totals must not be confused with per-operation costs: Rust has eleven scavenges and one major collection on each side, pauses 28.503 → 28.113 ms. Formatting has 69 scavenges versus 55 plus one major collection, pauses 22.482 → 32.131 ms; this particular trace has the opposite total-pause direction to the aggregate profiled/throughput per-operation values. Mismatch has 13 versus 20 scavenges as the faster candidate completes more parses. GC is included in all elapsed measurements; no universal GC improvement is claimed.

Because Rust/APIs retained small adverse point estimates and post-GC optimization activity remained, a separately declared four-block sensitivity check adds a second 150 ms settling round. It is not pooled into or substituted for default results:

| Workload, two settling rounds | Change | 95% interval |
| --- | ---: | --- |
| Rust | −0.42% | −3.08% to +2.32% |
| APIs | −0.28% | −3.09% to +2.60% |

These broad intervals do not prove equivalence. The candidate is retained on the representation simplification and confirmed local gains, with no confirmed material regression in the tested cases. Small stock-corpus effects remain uncertain; no speculative branch was added to chase them.

## Validation and next architectural lead

197 existing tests pass; typecheck, changed-file lint, build and whitespace checks pass. No parser-private repository tests were added. The final bundle is byte-identical to the frozen measured candidate. Each backend passes 54,092 complete AST/position comparisons, 2,614 corpus comparisons, 612 definition-related documents / 4,284 edits, 4,608 feature edits, the previous 12 guard documents / 24 edits, and nine new delimiter guard documents / 36 edits against baseline and fresh parsing. Six-feature Rust/APIs ASTs also match in the runtime probes.

The first typecheck reported TS7022 for recursive inference plus declaration/import errors while a parallel build cleaned dist. Adding an explicit `DelimiterRun` annotation and rerunning typecheck after the build passes. The annotation does not change emitted JavaScript; final rebuild verifies exact measured bytes. The failed output is preserved. Future typechecks and builds should run sequentially because they share generated declarations.

The mismatch guard reveals a separate algorithmic opportunity. Repeating `_a*b_c**d***e_f ` 100, 200, 400 and 800 times produces 5,450, 20,900, 81,800 and 323,600 opener visits respectively, identical in A/B and with full AST equality. Only 2,400 of the 323,600 visits reach `canPair`; the rest skip different configurations. This input family exhibits quadratic search growth, which direct links **do not eliminate**.

A subsequent experiment can investigate per-configuration opener search while preserving cross-kind nesting and invalidation of intervening runs. Simply caching a same-kind predecessor would be unsafe if it retained candidates consumed by another delimiter pair. That algorithm is not implemented or benchmarked here, and no gain from it is included in this commit. Likewise, raw token in-place mutation was not attempted: incremental definition changes still require the original stream. These are distinct ownership/search questions, not reasons to re-run the same representation experiment.

Follow-up: [delimiter search bounds](delimiter-search-bounds.md) tests the per-configuration direction and rejects its scope/edit regressions after runtime-driven adjustments. It instead retains stable source-order failure bounds in the original single chain, eliminating repeated search past removed boundary nodes. That separate commit's gains are not included in the measurements above.

`delimiter-chain-cb66acb-node26-m1pro.json` archives all 352 unprofiled observations (320 default, 32 sensitivity; longest measured window 299.481084 ms), frozen source/bundles, scripts, validation, setup failure, CPU/JIT/GC profiles, work counts and layout logs. Source was committed on main with KazariAI identity and title only, ahead of the single amended consolidated-record commit. No development worktree, revert commit or push was used.
