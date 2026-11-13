# 性能研究报告

整理日期：2026-11-16。近期测量均为 **Node 26.13.0 / Apple M1 Pro**；之后的测试只使用 Node 26。百分比默认表示耗时变化，负数更快。不同冻结基线之间不能直接串联收益，也不能把区间跨零解释为已证明没有回退。

## 最近五个主题

| 报告 | 比较范围 | 已有结论 |
| --- | --- | --- |
| [writeLine 提取](write-line-perf-node26.md) | 同一份改动，helper 对比手工展开；另测整体对暂存版 | 已内联仍残留函数目标检查；饱和换行扫描约慢 2.7%～5.7%。整体 parse 未检出明确变化。 |
| [字段索引掩码](latin1-field-mask-perf-node26.md) | 仅删除两处 `& 0x7FFFFFFF` | 没有证明掩码有稳定吞吐优势；更少检查指令不足以决定是否保留。 |
| [尾部纳入 SWAR](latin1-tail-only-node26.md) | segment 对比此前标量尾扫 | 通过行为和精确容量校验，减少一组写行代码；不能声称所有场景无回退。 |
| [Latin1 与 Index0](latin1-vs-index0-alias-node26.md) | 相同接口、容量与 19 类输入，正反顺序 | 连续 Unicode 别名上 Latin1 更快；无换行和长行 ASCII 上 Index0 明显更快。 |
| [事件循环候选](latin1-candidates-node26.md) | fused 等候选对比更早的八路展开版 | fused 的 spec 约 −6.32%；连续别名有回退。这不是最新 writeLine 版本对暂存版的收益。 |

每份 Markdown 配套同名 JSON，保留所有该轮配对观测、顺序、统计区间、输入哈希和验证结果，包括不利或未完成的结果。源码与 harness 按内容去重到 [reproduction.json](reproduction.json)：`{"$text":"<sha256>"}` 对应 `texts[sha256]`，UTF-8 内容保持原样。这些是测量快照，不保证在后续依赖或其他源码变化后仍能直接重建相同 bundle。

## 历史与测量方法

- [历史报告索引](history/README.md)：旧架构、inline、边界搜索和 SWAR 路线；状态均限定于当时基线。
- [对照方法](../README.md)与 [JIT 阶段诊断验证](abba-jit-phase-validation.md)。计时与剖析分开，不用诊断运行生成吞吐结论。
- [固定 remark 参考](remark-node26-m1pro.json)及 [69240f6 参考](remark-69240f6-node26-m1pro.json)保持原文件、原内容，供已有工具和历史比较使用；它们不代表目前工作区的倍数。

## 保留边界

最近五个主题保留完整配对观测；完整反汇编裁剪为摘要、关键片段和原内容哈希。较早 JSON 合并为 `history/data.json`，保留比较范围、统计汇总、反例和处置；有汇总的逐次观测、重复源码/bundle、测试明细及诊断日志已裁剪。`omitted` 表示内容不在报告树中，哈希不能替代内容，也不代表已完整保留复现材料。

本次整理前的全部 199 个文件另有**本机备份**：`node_modules/.cache/report-cleanup-20261116/reference-before.tar.gz`，文件清单和 SHA-256 在同目录的 `manifest.json`。缓存不纳入 Git，清除缓存后不能用它恢复；已跟踪的旧报告还可从整理前提交 `8f60cb4` 读取。
