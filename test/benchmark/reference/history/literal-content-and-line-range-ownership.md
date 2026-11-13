# Literal content ownership and borrowed scan ranges

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Status: D is retained for measured spec/edit gains, reduced bundle size and explicit line ownership. It combines Q's literal content ownership and complete block rescanning with borrowed read-only line ranges. Prior paragraph, heading and shortcut candidates remain separate and unadmitted on `main`. No new remark ratio or M3 result is claimed; cross-zero guards still leave uncertainty about small regressions.

Source commit: `69240f6 perf: emit literal content from complete block scans` (KazariAI; title only).

Working-tree review update: exact first-round Q was temporarily restored for review. After the user clarified that known regressing versions must not remain in the worktree, `main` was restored to accepted Q+D, byte-identical to its measured 160,583 B bundle. The borrowed scan ranges are retained; editing still owns an independent copy. 196 tests and typecheck pass. Later list-spread candidates are preserved separately and are not part of the working source.

## Model

Literal block recognition already knows the opening marker, indentation, closing boundary and physical source rows. Q makes that phase emit the final literal body, primitive info string and exact token span. AST construction consumes these facts directly. It removes the nested `FencedBlock` descriptor, repeated body extraction and feature-specific end-position reconstruction. Code normalizes line endings to LF; math retains its existing raw-ending contract. Codegen remains intact.

Producing final content exposed a cost in the old edit algorithm: a fence extending beyond an artificial scan-window end could be scanned and projected repeatedly as the window grew. Complete scanning instead proceeds once from the restart block until whole-record convergence. Record dependency bounds and shifted-token equality still determine convergence; no implicit close protocol is added.

Q retained the old scanner call interface by copying the entire suffix of the line index. That introduced measurable middle-edit regressions. D separates the existing line reader type from the owned buffer: `BlockLines` is a type-only projection of `BlockLineBuffer`. Range scanning borrows a typed-array subarray; editing still copies geometry before overwriting it. Grammar readers cannot mutate the buffer through their input type. Nested scans consume ranges synchronously, before their owner can be reset. No new instance fields or per-row dispatch are introduced.

Runtime source files for D alone are `block/lines.ts`, `block/scanner.ts` and `block/profile.ts`. The full Q+D candidate additionally changes `block/fence.ts`, `block/tokens.ts`, `fragment/block.ts`, `profile/features/code.ts` and `profile/features/math/block.ts`, with two public syntax tests in `test/mdast.test.ts`.

## Comparison scopes

| Artifact | Scope | Bytes |
| --- | --- | ---: |
| Accepted A | `dcf11a6`, before this research | 162,628 |
| Isolated Q | Literal ownership and complete scanning, with suffix copies | 160,358 |
| Main A | Q plus older paragraph/heading/shortcut candidates | 161,073 |
| Main D | Main A plus borrowed read ranges | 161,298 |
| Isolated D | Only Q+D, excluding those older candidates | 160,583 |

The full isolated candidate is 2,045 B smaller than the accepted baseline. D alone adds 225 B to Q; it is not a standalone size reduction. Minification settings are unchanged. Public declaration files are byte-identical.

The isolated build is an export of visible main changes, not another development worktree. Rebuilding Q through the same exported build setup reproduces the original Q bundle byte-for-byte (`263684f7dd4985a76f85fbebee4a83eb69c34310a5eaf95ce324ac00aad2f7ee`). D's isolated bundle hash is `dd573943f5aec969f0295f202a6d254c19f9a11628df078a982e0a29c0717695`.

## Measurements

Node 26.13.0 on M1 Pro, with `taskpolicy -c utility`. Alternating ABBA/BAAB blocks use fresh processes and module caches, 250 ms warmup, full GC, 150 ms settling and approximately 300 ms measured windows including natural GC. Every window is capped at 500 ms. Own builds, tests and profiles do not overlap throughput. CPU/JIT runs are separate diagnostics. All batches are retained; intervals crossing zero are uncertainty, not proof of equivalence.

Q's first four blocks showed spec −2.83% and examples −3.87%, but middle insertion regressed +3.42% and middle replacement +7.75%. Q alone did not pass admission.

| Comparison | Case | Change | 95% interval |
| --- | --- | ---: | --- |
| Main A → main D, 8 blocks | Spec | −0.41% | [−2.06%, +1.27%] |
| Main A → main D, 8 blocks | Examples | +0.02% | [−2.20%, +2.30%] |
| Main A → main D, 8 blocks | Middle replacement | −7.24% | [−8.23%, −6.23%] |
| Accepted A → isolated D, all 12 blocks | Spec | −1.87% | [−3.30%, −0.41%] |
| Accepted A → isolated D, all 12 blocks | Examples | −0.75% | [−2.43%, +0.96%] |
| Accepted A → isolated D, all 12 blocks | Rust | −0.38% | [−1.82%, +1.08%] |
| Accepted A → isolated D, all 12 blocks | APIs | +0.06% | [−1.46%, +1.61%] |
| Accepted A → isolated D, 4 blocks | Middle insertion | −1.19% | [−2.90%, +0.55%] |
| Accepted A → isolated D, 4 blocks | Middle replacement | −1.16% | [−3.00%, +0.73%] |
| Accepted A → isolated D, 4 blocks | Fence-window edit | −14.84% | [−19.29%, −10.15%] |
| Accepted A → isolated D, 4 blocks | Document creation | −1.34% | [−3.72%, +1.10%] |
| Accepted A → isolated D, 4 blocks | Head edit | −12.33% | [−14.62%, −9.98%] |
| Accepted A → isolated D, 4 blocks | Tail edit | −2.80% | [−4.98%, −0.58%] |
| Accepted A → isolated D, 4 blocks | Definition edit | −0.14% | [−0.78%, +0.50%] |
| Accepted A → isolated D, 4 blocks | Projected fence | −0.73% | [−1.43%, −0.03%] |
| Accepted A → isolated D, 4 blocks | Indented code | −18.89% | [−21.80%, −15.86%] |

The isolated first four spec blocks were −0.54% with an interval crossing zero; the independent eight-block confirmation was −2.52%. The pooled figure above retains both. The first-round Q estimates are not transferred to D.

## Runtime attribution and limits

- A fence-window edit drops from nine scans / 2,324 fence checks to one scan / 802 checks. This explains why complete scanning matters when the changed block crosses many old windows.
- One exact middle replacement copies 156,512 B in the accepted baseline and 230,304 B in Q. The additional full suffix copy accounts for 74,208 B, replacing a 416 B window copy. Q's slice self samples rise from 9.629 to 11.472 μs/edit. Borrowed ranges remove the suffix geometry copy while retaining the required 156,096 B writable clone.
- The earlier private range-factory variant C showed examples +5.23%. Examples calls no range slices. V8 slack-tracked objects in main A/C are both 80 B with seven in-object properties. Removing that private factory simplifies D, but no evidence establishes it as the causal fix for the adverse examples result.
- Separate accepted-A/isolated-D spec profiles show code-builder self samples 30.75 → 26.62 μs/parse and GC observations 27.97 → 23.59 μs/parse. These are diagnostic, not additive accounting of the throughput gain. Profiling overhead and unchanged functions also vary.
- Both spec JIT logs invalidate four dependent codes after full GC and ten during settling, then complete seven/six optimizations during measurement. No JIT-quiescence claim is warranted. The exact cause of between-batch throughput differences remains unresolved.
- Source-labelled profiles still place physical line-index scanning around 199/205 μs per profiled parse. This is a remaining architectural cost, not evidence that an unchanged previously rejected line-index strategy should be retried.

## Validation and retained failures

Main D passes 196 tests, typecheck, changed-file lint and the standard build. Main D and isolated D each pass forced-CSP comparisons of 2,614 corpus ASTs/positions, 2,916 code/math documents with 8,748 edits, and 4,608 public feature edits. Isolated D passes those same matrices with codegen enabled; main D also passes the generated-tokenizer code/math matrix. The new repository tests exercise public syntax, not parser-private fields or protocols.

The literal-content changes fix a class of inherited projected-tab value errors, but inherited structural tab classification and tab-indented fence-closing discrepancies remain. These are not described as conformant or encoded as new expected syntax behavior.

Do not retry the following unchanged: G's eager per-row projection under repeated artificial windows; H/J's use of a projected view's normalized-ending flag to infer final body spelling; or I/M's scan-start parameter-form tuning. Their failures, runtime probes and all intermediate bundles are preserved in `literal-content-ownership-dcf11a6-node26-m1pro.json`. Current range variants, complete observations, CPU profiles, JIT logs and source hashes are in `line-range-ownership-main-node26-m1pro.json`.

Retention uses D's own measurements, not Q's larger first-round estimates. No tested guard has an established regression, but the confidence intervals do not prove universal non-regression. The 100× remark goal remains unmet.
