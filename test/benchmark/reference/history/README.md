# 历史报告

本区只记录当时的基线、决策和反例；文中的 current / kept / accepted 与目标状态不代表目前源码，也不启动任何旧研究任务。最近五轮见[近期索引](../README.md)。

- [Latin1 / SWAR 演进](latin1-evolution.md)：替代重复的早期扫描报告。
- [块解析架构摘要](architecture.md)：替代容器栈、直接 AST 和块 frame 的长篇设计及过程记录。
- [历史路线表](routes.md)：保留路线、反例和原 JSON 对象路径，避免重复失败实验。

## 数据如何查找

旧的 122 个 JSON 合并至 [data.json](data.json)，键为原文件名。例如：

```sh
jq '.records["progress-node26-m1pro.json"].reviewedCandidates' test/benchmark/reference/history/data.json
```

报告中的旧 JSON 文件名是记录标识，不再是独立文件路径。已有汇总的历史逐次观测、重复 payload 和大型诊断明细已裁剪；保留数量/哈希并标记 omitted。最近五个主题仍保留所有配对观测。没有删掉不利方向的汇总，也没有据此重新计算或筛选历史收益。

## 保留的专题说明

- [Full-delimiter literal search for code-span closures](code-span-literal-search.md)
- [Compiled block scopes: attribution and disposition](compiled-block-scopes.md)
- [Link delimiter runs directly](delimiter-chain.md)
- [Delimiter classification timing and formatting declarations](delimiter-lexical-classification.md)
- [Preserve delimiter search bounds after unlinking](delimiter-search-bounds.md)
- [Current baseline and inline entry search](entry-search-and-current-baseline.md)
- [Exact dependencies and shortcut-label facts](exact-definition-research.md)
- [Fence descriptors and negative recognition paths](fence-descriptor-research.md)
- [Indented code: qualification versus body materialization](indented-projection.md)
- [One inline boundary search across profiles](inline-boundary-unification.md)
- [Inline 事件的边界所有权](inline-event-ownership.md)
- [Inline recognition ownership and whole-span matching](inline-recognition-research.md)
- [Inline input bounds and shared boundary discovery](inline-source-bounds.md)
- [Physical line demand after complete literal publication](line-demand-after-literal.md)
- [Physical line discovery with one native stream](line-ending-stream-research.md)
- [聚焦行输入的架构研究](line-input-architecture.md)
- [Line producer control and historical route audit](line-producer-history-audit.md)
- [Consume bracket frames in source order](linked-bracket-frames.md)
- [List-item spread ownership on accepted main](list-spread-ownership-main.md)
- [List-item spread ownership](list-spread-ownership.md)
- [Literal content ownership and borrowed scan ranges](literal-content-and-line-range-ownership.md)
- [Literal suffix representation after the upstream sync](literal-suffix-research.md)
- [Project literal line prefixes directly](logical-line-projection.md)
- [Current main reference and physical-row demand](main-reference-and-row-demand.md)
- [Bracket frames with stable named facts](named-bracket-frames.md)
- [Native callback batching for physical line discovery](native-line-callback.md)
- [Raw inline stream lifetime](raw-token-retention.md)
- [Record link closures during pairing](reference-close-ownership.md)
- [Definition availability versus actual dependencies](reference-demand-research.md)
- [Start inline resolution at the first raw token](resolution-window.md)
- [Three-field line storage: runtime attribution](runtime-attribution.md)
- [Segment mapping search: locality without a monotonicity assumption](segment-mapping-search.md)
- [由 profile 统一 AST 子节点投影](semantic-build-projection.md)
- [Reuse complete semantic prefixes during inline emission](semantic-prefix-emission.md)
- [Shared block dispatch plans](shared-block-dispatch-plans.md)
- [Shared inline boundary discovery: implementation and disposition](shared-boundary-search.md)
- [Shortcut caller control-flow attribution](shortcut-control-research.md)
- [Source projection: semantic boundary and actual string materialization](source-projection-boundaries.md)
