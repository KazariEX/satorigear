# Reuse complete semantic prefixes during inline emission

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Retained source: **`20f4f59` — `perf: streamline resolved inline token emission`**.

The final candidate D improves the long-semantic-prefix guard **4.87%**, CI **[−6.10%, −3.62%]**, and reduces the bundle by **110 B**. Spec changes −0.37%, CI [−1.62%, +0.89%]: **no established spec gain**. No new remark measurement is made; the earlier 80.032× ratio belongs to the exact prior bundle, not this changed one. The 100× objective remains unmet.

## Invariant and model

`2c1b10c` already finds the first raw token and starts bracket analysis/pairing there. Emission still restarted at token zero, redispatching the complete semantic prefix one token at a time. D copies that prefix into the existing output array once and starts emission at the same known boundary. An empty prefix uses `[]`, avoiding an unnecessary native empty slice.

This does not delete a token representation or change tokenization, pairing, definition dependencies, retained raw streams or incremental correspondence. It eliminates dispatch over already-semantic prefix records; it does not claim fewer numeric slots copied. The output remains independently owned by this resolver invocation, and the raw input remains immutable.

The prefix contains no raw opener, closer or delimiter, so emission's raw stack and consumed-span state are still initial at its boundary. A leading unmatched semantic `LinkTail` is copied unchanged. A component's first raw bracket can promote the preceding component token: it rewrites the copied output tail, exactly as before. The prefix is therefore copied, not borrowed or shared with a mutable output.

The same emitter now lets an unmatched close fall through to the existing common semantic/raw output path. Matched links, component/span closes, footnotes, literal-bracket exclusions and consumed ranges retain explicit early exits. This removes duplicate copy/literal dispatch and one nested branch group; it is not manual minification or a new close protocol.

| File | Change |
| --- | --- |
| `packages/satorigear/src/profile/resolve.ts` | Copy the known semantic prefix, reuse start/end bounds, share the unmatched-token emission exit, and avoid empty slicing |
| `packages/satorigear/src/inline/tokens.ts` | Export the existing compile-time layout enum internally so prefix slicing uses the centralized stride |

The layout enum is not exposed through the package entry point. No feature API, runtime field, persistent cache or parser mode is added. Final source diff: 30 additions / 32 deletions across the two files.

## Candidate progression and regression investigation

| Variant | Meaning | Bundle | Outcome |
| --- | --- | ---: | --- |
| A | Accepted baseline | 161,093 B | Frozen reference |
| B | Bulk prefix copying, including empty prefixes | 161,102 B | Prefix −4.86%; +9 B, not retained |
| C | B plus shared unmatched-token emission | 160,970 B | Prefix −4.82%; reference edit +3.48%, not retained |
| D | C, with `[]` for an empty prefix | **160,983 B** | Retained after direct control and independent reference confirmation |

B's initial spec +0.39% and suffix +0.44% intervals cross zero; they are retained in the archive. C's reference-edit regression is resolved: +3.48%, CI [+2.45%, +4.52%]. It was investigated before adjustment, not averaged against the prefix benefit.

Public edit probes find **400 re-resolved regions per definition insertion/removal, all with empty prefixes**, and 1,600 emission visits in both A/C. Raw input and complete output/positions remain equal. C therefore added 400 empty native slices without removing token visits on this workload.

Four-block CPU diagnostics of this exact availability-edit workload give approximately 203.22 → 207.35 μs/edit. Emitter self samples increase 6.40 → 10.59 μs, while observed GC is 8.00 → 8.11 μs. Sampling is not an additive causal decomposition; these observations motivate the empty-prefix adjustment rather than proving an exact per-slice cost.

The isolated **C → D** ABBA/BAAB control gives **−2.35%**, CI [−3.67%, −1.01%]. It changes only empty-output initialization. This supports avoiding empty native slices, but the result is not subtracted from the earlier A/C percentage. Direct A/D reference timing is initially +0.90% with a broad interval, then −0.12%, CI [−1.33%, +1.11%], in independent eight-block confirmation. All twelve blocks combine to **+0.22%, CI [−0.81%, +1.26%]**. Exact equivalence and every possible regression remain unproven.

The other CPU group profiles B's long-prefix guard: approximately 113.20 → 108.22 μs, with observed GC 3.18 → 3.45 μs. Emitter self samples actually move 2.02 → 2.78 μs despite fewer visits, illustrating inlining/native-attribution limits. Do not attribute the whole gain to a sampled function or GC reduction. These profiles describe B and C, not a separately profiled D.

JIT logs for both diagnostic groups show optimization completions during measurement (prefix A/B: 4/4; reference A/C: 2/2) without measured bailouts/invalidations. They do not establish JIT quiescence. Raw profiles, phase-tagged JIT/GC logs, clock audits and ±100 μs clipping sensitivity are preserved.

## Final controlled measurements

Node **26.13.0**, absolute executable, **Apple M1 Pro**, `taskpolicy -c utility`; not an M3 replication. Alternating ABBA/BAAB, fresh process/module per observation, 250 ms warmup, full GC, 150 ms settling, approximately 300 ms measured with natural GC, 500 ms phase cap. No own builds, tests or profiles overlap throughput. Across B/C/D and the direct adjustment control, **448 observations** are retained; longest measurement **299.524167 ms**. Reference-edit settling is paired and all recorded settling counts are even.

Positive means slower. D has four blocks per case except the combined reference-edit row, which has twelve with Student t(11). Different source variants are never pooled.

| Workload | Change | 95% CI |
| --- | ---: | --- |
| spec | −0.37% | [−1.62%, +0.89%] |
| examples | +0.05% | [−1.29%, +1.41%] |
| Rust | −0.91% | [−2.37%, +0.57%] |
| APIs | −1.31% | [−5.61%, +3.18%] |
| document/spec | +0.25% | [−0.32%, +0.83%] |
| tail edit | −0.24% | [−1.69%, +1.22%] |
| 800 code spans followed by emphasis | **−4.87%** | **[−6.10%, −3.62%]** |
| emphasis followed by 800 code spans | +0.15% | [−0.75%, +1.06%] |
| semantic code spans only | +0.06% | [−0.78%, +0.91%] |
| component-label groups | +0.44% | [−0.40%, +1.29%] |
| definition availability edits, combined | +0.22% | [−0.81%, +1.26%] |

No resolved regression remains in these measured guards, but crossing-zero intervals do not prove universal non-regression. This is a bounded control-flow improvement with a demonstrated local benefit and smaller bundle, not a spec breakthrough or completion of the full goal. No CSP throughput claim is made.

## Executed work and correctness

Final D's generated/CSP probes compare complete raw inputs, resolved token streams and AST/positions with A. Raw inputs remain unchanged, including component-tail promotion. The emitter visits:

| Input | A | D | Prefix tokens copied in bulk |
| --- | ---: | ---: | ---: |
| spec | 1,356 | 1,325 | 31 |
| examples | 942 | 932 | 10 |
| Rust | 22,541 | 22,313 | 228 |
| APIs | 3,934 | 3,934 | 0 |
| long prefix | 802 | 2 | 800 |
| long suffix | 802 | 802 | 0 |
| semantic-only guard | 0 | 0 | 0 |

The semantic-only path returns before emission. These counts describe logical dispatch, not actual allocated bytes or machine instructions. The small spec reduction explains why the local prefix result must not be advertised as a general 5% gain.

D passes all **198 existing tests**, build, typecheck, changed-file lint and whitespace checks. Each backend passes 2,614 corpus AST/position comparisons, 4,608 feature edits, 612 definition-related documents / 4,284 edits, earlier bracket/delimiter guards, 3,072 indented-code documents / 6,144 edits, and 18 prefix/suffix/component public-syntax documents / 36 edits. C additionally ran the 54,092 topology and 46,812 delimiter-matrix differential documents per backend; those larger matrices were not repeated after the one-line empty-prefix initialization adjustment. No parser-private repository test is added.

An edit-counter setup attempt mistakenly called the imported parser factory as `base.createParser`; it failed before producing an edit report. The corrected factory call passes. Both failed logs and script are preserved; no throughput observation is discarded or restarted for this diagnostic setup error.

## History and reproduction

Final bundle SHA-256: `5eb3f02a5b9c6527c861e6d0e63655cf9419206dac4d64db1827c1b50dece911`. Source is committed on main using KazariAI identity and a title only, ahead of the single consolidated records commit. No development worktree, revert commit or push is introduced.

`semantic-prefix-f0b8780-node26-m1pro.json` contains frozen A/B/C/D bundles, source patches, all normal/control observations, validation, counts and V8 diagnostics. Canonical candidates are `candidate-B.mjs`, `candidate-C.mjs`, `candidate-D.mjs`. The validator alias `candidate.mjs` progressed through B/C/D; B/C outputs are snapshotted in `validation-B/` and `validation-C/`, and top-level final validation outputs describe D. Reproduction must select the intended canonical bundle as that alias.

The earlier consumed-whitespace LF pattern was found to be an exact historical rejected variant in `inline-boundary-unification.md`; it was screened out without implementation or timing. This experiment instead extends the newly established first-raw-token boundary. Do not retry unconditional empty-prefix slicing, discard the adverse C sample, or retime the unchanged accepted implementation to claim a spec gain.
