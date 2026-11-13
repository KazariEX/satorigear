# List-item spread ownership on accepted main

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Status: not admitted. All experiments were made visibly on `main`, investigated and removed. Working source and its 160,583 B bundle again match accepted `69240f6` exactly, including borrowed `subarray` scan ranges and independently copied edit data. Restored source passes 196 tests and typecheck. No new source commit, revert commit or remark comparison was created.

The earlier Q-only findings are in `list-spread-ownership.md`. They do not describe the main-base comparisons below.

## Model and candidates

B removes the generic nested scanner's blank-separation callback and trailing blank rescans. The list-item builder derives `spread` from its already-built direct-child positions instead. An exclusive end at column 1 is normalized to the preceding physical line. `ListItemSpreadClose` disappears; an ordinary explicit `ListItemClose` remains. No implicit close protocol, metadata field, feature API or node-position format is introduced.

The production files are `block/scanner.ts`, `constants/block.ts` and `profile/features/list.ts`. Two public syntax/edit tests accompany the candidate. Production source shrinks by three lines; the bundle is 160,463 B, 120 B below baseline. Public declarations match.

E is a diagnostic ablation: retain the original scanner and closing kinds, change only the consuming builder. It deliberately retains redundant work and is not an admission candidate. Its bundle is 160,850 B.

F moves B's span loop into a private `hasBlankSeparatedChildren` predicate. The model and executed comparisons stay the same. Its bundle is 160,522 B, 61 B below baseline but 59 B above B. The extra function did not establish an advantage over B and was removed.

## Measurements

Node 26.13.0 on M1 Pro, `taskpolicy -c utility`; alternating ABBA/BAAB, fresh processes and module caches, 250 ms warmup, full GC, 150 ms settling and approximately 300 ms measured windows including natural GC. All phases remain within 500 ms. Own builds/tests/profiles do not overlap throughput. All completed batches are retained.

| Main → B | Blocks | Time change | 95% interval |
| --- | ---: | ---: | --- |
| Spec | 12 | −0.44% | [−1.18%, +0.31%] |
| Examples | 20 | +0.88% | [−0.12%, +1.90%] |
| Rust | 12 | −1.70% | [−3.77%, +0.41%] |
| APIs | 12 | −0.11% | [−1.31%, +1.11%] |
| Document/spec | 12 | +0.62% | [−0.23%, +1.48%] |
| Tail edit | 12 | +1.01% | [−0.48%, +2.52%] |
| Middle insertion | 4 | −0.44% | [−3.49%, +2.70%] |
| Middle replacement | 4 | +0.14% | [−2.56%, +2.91%] |
| Definition edit | 4 | −0.30% | [−2.93%, +2.41%] |
| List blank-line edit | 4 | −8.49% | [−11.09%, −5.82%] |
| List head edit | 4 | −2.98% | [−5.51%, −0.38%] |
| Wide list | 4 | −5.43% | [−7.01%, −3.82%] |
| Multiple blocks per item | 4 | −2.72% | [−4.34%, −1.07%] |
| Nested quote headings | 4 | −1.99% | [−4.03%, +0.10%] |

The list-heavy benefits are real within these measurements. However, examples, document creation and tail edits retain positive point estimates and intervals that do not exclude small regressions. Cross-zero intervals do not prove non-regression. This is not a rejection for missing a fixed spec-gain threshold.

## Attribution and adjustment

Untimed executed-work counters find, per complete examples batch, 262 → 0 nested visitor calls and 414 → 142 blank-line checks, with 44 new AST-span comparisons. Rust removes 6,334 visitor calls and reduces blank checks 6,906 → 488, adding 142 comparisons. The complete corpus ASTs match. These counts are not allocation-byte measurements or an additive explanation of elapsed time.

The consumer-only E comparison is spec +0.08% and examples +0.86%, both intervals crossing zero. It does not establish the new span loop as the sole cause of the adverse estimates. CPU/JIT evidence motivated separating the predicate in F rather than immediately dropping the route.

F's standard 12-block comparisons initially look better: examples −1.87% [−2.67%, −1.06%] and Rust −2.22% [−3.90%, −0.51%]. Spec/API intervals cross zero. But a direct eight-block B → F examples comparison is +1.36% [−0.57%, +3.33%]. Subtracting independent A → B and A → F batches would therefore provide a misleading attribution to predicate extraction.

A further eight-block shared-observation diagnostic uses `ABFFBA/FBAABF`. Each pair extracted from those six-observation blocks is strictly alternating ABBA/BAAB. A → B is −0.38%, A → F +0.24%, and B → F +0.63%; all intervals cross zero. This different observation cadence is kept separate from the standard pooled tables. It does not establish either spelling as faster. F was removed, and B received its own final examples and edit checks rather than inheriting F's favorable results.

CPU summaries intersect sample intervals with the measured `hrtime` window and verify clock alignment. Inspector startup is excluded. One operation here is a complete batch of 652 examples, not one document. Effective sampling cadence is approximately 872–875 μs despite requesting 100 μs. JIT optimization still occurs during measurement, so these are not quiescent-runtime results.

The builder's principal inlining edges remain. F's predicate is inlined. Separate optimized-code logs show builder machine code A/B/F at 5,392/6,392/6,612 B, with 26 stack slots in each. Thus neither smaller generated machine code nor fewer stack slots explains F's favorable independent batches. The exact small cross-batch timing differences remain unresolved; no causal compiler story is claimed.

## Correctness and disposition

B and F each pass 198 public tests, typecheck, changed-file lint, 2,614 full corpus AST/position checks per codegen/CSP backend, and 4,608 feature edits per backend. Each also passes the expanded 11,720-document/26,520-edit matrix per backend, including 5,700 equal-length edits. E passes 198 tests and typecheck. No parser-private repository tests were added.

Three unique inherited spread errors are corrected by the candidates. In those exceptions, all non-spread AST fields match baseline and the type/children/spread projection matches the canonical parser. An inherited fenced-code whitespace-value mismatch remains; full canonical AST equality is not claimed. The two proposed public tests and every candidate source snapshot remain in the archive, not in the restored test suite.

Do not repeat unchanged loop placement, private-helper extraction, renaming or warmup tuning to seek favorable batches. Reopen when an ownership or consumer invariant removes work beyond moving inference to a second AST traversal, or when a material pipeline/runtime change makes these results obsolete. The semantic finding remains useful; this experiment does not reject all future removal of generic spread inference.

Full reports, scripts, source/build snapshots, CPU/JIT and optimized-code logs, and restored-state validation are in `list-spread-ownership-main-node26-m1pro.json`. Main retains accepted Q+D. The 100× remark goal remains active and unmet.
