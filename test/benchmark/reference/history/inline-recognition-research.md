# Inline recognition ownership and whole-span matching

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

Baseline: accepted production source `a126216`, bundle SHA-256 `a791d2624423e3c9d32aa60896480a31d78c7b1cf719a8ed010008d235fd79c9`. The inherited scanner/paragraph/heading changes were excluded and preserved byte-for-byte. Neither candidate is admitted.

## Work counts before implementation

Current spec parsing asks the resolver to classify 206 formatting delimiter runs, and all 206 are eligible. Eager lexical classification therefore cannot prune these tokens. Rust has 342 raw runs but only 239 reach classification: outer syntax already consumes the other 103. Moving classification earlier would add work there. This is consistent with rejected route 20; that route was not reimplemented.

There are 222 spec regions requiring resolution and 1,356 token visits in bracket analysis. Only 30 regions / 167 visits contain no raw bracket candidates. This does not justify another feature-dependent resolver fork by itself.

## Candidate and adjustment

The code-span experiment replaces the complete closing search, retaining the existing scanner signature, raw token, builder, incremental cache, and CSP path. This differs from historical route 81, which substituted a regular expression for individual marker-run scans and also changed fences.

- **A:** original native `indexOf` search followed by marker-run comparison.
- **B:** one sticky backreference expression recognizes the whole span, trying closure after successive characters. Bundle: 162,700 bytes, 128 fewer than A.
- **C:** after runtime investigation, the expression consumes plain-text stretches and nonmatching runs before the closing run. Bundle: 162,714 bytes, 114 fewer than A.

Spec marker-run helper calls fall from 1,032 to 513 in B, but 513 whole-span regex tests replace those calls. This is relocation of matching work, not proof of less character processing.

## Unprofiled comparisons

Positive means slower. All observations use Node 26.13.0 on Apple M1 Pro, `taskpolicy -c utility`, fresh subprocess/module state, 250 ms warmup, full GC, 150 ms settling, and about 300 ms timed windows including natural GC. Orders alternate ABBA/BAAB. All 208 observations are retained; the longest timed window is 299.113 ms.

| Comparison | Input | Elapsed change | 95% CI |
| --- | --- | ---: | ---: |
| A → B | spec, 8 blocks | −0.08% | −1.19% to +1.04% |
| A → B | examples, 8 blocks | +1.39% | +0.03% to +2.76% |
| A → B | long literal code span | +2674.92% | +2612.33% to +2738.97% |
| A → B | unclosed long span | +2027.70% | +1976.65% to +2080.01% |
| B → C | long literal code span | −84.88% | −85.09% to −84.65% |
| B → C | unclosed long span | +244.09% | +240.20% to +248.03% |
| B → C | many nonmatching runs | −76.82% | −77.33% to −76.29% |
| A → C | long literal code span | +315.74% | +311.05% to +320.49% |
| A → C | unclosed long span | +7100.33% | +7003.97% to +7198.00% |
| A → C | many nonmatching runs | −17.59% | −19.07% to −16.08% |

The long-span input has 14,000 literal body characters; the nonmatching-run input contains 800 double-backtick runs separated by words inside single-backtick delimiters. These are public syntax workloads. C was not rebenchmarked on stock corpora after its independent guards clearly failed. No stock-corpus gain is claimed for C, and no ratios above were obtained by multiplying separate comparisons.

## Runtime attribution and its limits

The examples CPU profile is too coarse to explain a 1.39% difference accurately. GC did not show a clear amplification and there were no measurement-phase deoptimizations in those inspected traces. This does not prove a cause for the small stock-corpus regression.

Long-span profiles make the added work visible. In the A/B diagnostic, code scanner self time is approximately 0.32 versus 36.20 μs per parse. In the separate A/C diagnostic it is 0.34 versus 4.49 μs. The rest of the parser and GC do not account for a comparable difference. These are sampled attribution values, not exact additive costs or admission measurements.

C's long-input trace contains two measurement-phase deoptimizations in an anonymous function. A follow-up with `--trace-file-names` identifies the matching bytecode offsets and reasons as the profiling harness's OSR and loop-exit calls, not a parser scanner. Thus it would be incorrect either to report zero global deoptimizations or to blame this parser regression on those events.

The controlled B/C comparison shows that changing how the regex consumes text substantially improves successful long matches while worsening unsuccessful searches. It supports a matching-algorithm explanation; it does not establish an exact count of native comparisons or backtracking instructions. No instruction-level claim is made.

## Validation and disposition

Both B and C passed complete AST/position comparisons against A in generated and forced-CSP modes. Each mode covers 2,614 corpus variants, 5,400 code-span syntax combinations and 600 independent edit comparisons. Coverage audit: the initial code-span edit script compared only returned change ranges. The follow-up `check-trees-B/C.mjs` now checks full AST/positions after all 600 edit steps against both baseline and fresh parse, in both backends; all pass. Original artifacts are preserved. These are differential checks, not a claim of new normative conformance coverage. Public declaration files are byte-identical. No parser-private tests were added.

This route was closed after measurement, profiling, an algorithm adjustment, and direct comparisons against the original. The successful mismatch-heavy case does not offset major regressions elsewhere. Adding syntax-specific fallback branches would undermine the intended simplification, so neither source variant is retained.

The more useful constraint for further architecture work is to remove a representation or a complete pass while preserving native literal searches and useful negative proofs. Replacing a JavaScript loop with a complete matcher does not itself remove the matching work. Reopen these exact patterns only after a relevant runtime or algorithmic change, not after another noisy stock-corpus sample.

Frozen bundles, source patches, all throughput samples, CPU profiles, GC/JIT logs, probes and validation scripts are embedded with hashes in `inline-recognition-research-a126216-node26-m1pro.json`. No current remark ratio is established; the 100× objective remains active and unmet.
