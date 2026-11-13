# Physical line demand after complete literal publication

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

This is a work-count screen, not another compressed-line implementation or throughput experiment. Production remains unchanged on the source tree `c7b3facdda5b13409a0822025d48c1a00e38b5e5` rebased onto `8aa9ee5`. The 100× goal remains active and unmet.

The hypothesis was that complete literal materialization had removed enough per-row `End` queries to invalidate the earlier three-field line-table results. That would justify revisiting the cost of deriving `End` instead of storing it. Counters contradict the prerequisite, so the old route was not reopened and no ABBA observations were collected.

## Compared sources and scope

- Before: the frozen `dcf11a6` A bundle recovered from `literal-content-ownership-dcf11a6-node26-m1pro.json`, SHA-256 `27456057512030da66d140e8ab416218e88163c6f4dcd5b92e9c93256d0d9b2f`.
- Current: the restored post-sync bundle, SHA-256 `c98a3b1976e99d0d26cf3b64557fa8f6292b17c1ce28198bda2682508e9d2d38`.

Both are exercised through public parsing. The instrumented class methods count physical/borrowed versus projected line queries separately. There is no added parser API, source modification, or parser-private test. All diagnostic execution uses `taskpolicy -c utility` and Node 26.13.0. These are source-level call counts, not allocated bytes, native character comparisons, or CPU time. The two versions include the intervening upstream changes; the broad difference is not claimed to isolate a single commit.

## Observed demand

| Corpus | Physical rows, both | Physical `End`, before → current | Physical `Start`, before → current | Physical `Next`, before → current |
| --- | ---: | ---: | ---: | ---: |
| CommonMark spec | 9,756 | 11,412 → 12,104 | 14,991 → 13,616 | 2,932 → 2,929 |
| CommonMark examples, 652 documents | 1,574 | 4,250 → 4,338 | 3,055 → 3,026 | 593 → 558 |
| Rust releases | 16,166 | 71,338 → 71,340 | 37,009 → 37,005 | 9,842 → 9,842 |
| Public APIs | 2,154 | 6,796 → 6,796 | 2,742 → 2,742 | 179 → 179 |

Spec projected `End` calls decrease only from 1,566 to 1,549. Locator calls remain 7,361. Scanned source length remains 204,706 UTF-16 code units. The other corpora likewise retain their physical row counts and locator-call counts.

The codegen and forced-CSP probes produce identical counts and full AST hashes. Across the 655 corpus documents per backend, current and previous complete AST/positions compare equal. This scope includes the stock feature profile for Rust/APIs, but does not include edits or CR/CRLF transformations; none is needed to claim only the measured stock demand.

An independent caller-stack probe on spec attributes the physical `End` calls:

| Consumer/call-site group | Before | Current |
| --- | ---: | ---: |
| `scanBlockLines` leading whitespace/blank handling | 3,422 | 3,422 |
| Paragraph continuation line bound | 1,597 | 1,597 |
| `indentOffset` | 953 | 953 |
| `fenceAt` | 691 | 691 |
| `closesFence` | 688 | 688 |
| Fence publication/body projection | 1,376 | 2,064 |

The last row groups the old two `fencedBlock` call sites versus the current two `appendFencedToken` sites and one `physicalFenceContent` site. Current code obtains the body endpoint separately from the complete token endpoint. This explains 688 of the 692 additional physical `End` calls; it does not establish that those calls are redundant or slower than the work previously done elsewhere. Caller-stack probes are deliberately excluded from performance timing.

## Decision and reopening boundary

Keep stored `End` and the current four-field representation. Complete literal publication reduced some start/projected queries but did not remove physical row production, make `End` cold, or reduce the demand on which the rejected derived-End tradeoff depended. No speedup or regression estimate is inferred from these counts.

Historical evidence consulted includes `runtime-attribution-fed4f91-node26-m1pro.json`, the compressed-layout candidates in `progress-node26-m1pro.json`, and the dense/current-row and lazy-fill controls in `line-input-architecture.md`. Those routes remain closed. Reopen only after a consumer change demonstrably removes relevant row production or bound queries; moving loop scheduling, renaming accessors, or changing field packing alone is insufficient.

Frozen bundles, instrumented bundles, runners, full method counts, complete AST hashes, caller locations and restoration hashes are embedded in `line-demand-after-literal-4791317-node26-m1pro.json`. The initial instrumentation attempt stopped at a uniqueness assertion because other classes also define `start(index)`; the corrected probe is scoped to `BlockLines` before replacing methods. No parse observations were produced by that failed setup.
