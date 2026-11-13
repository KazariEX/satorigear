# Latin1 / SWAR 的历史演进

以下是早于最近五个主题的实验摘要，均为历史基线，不代表现在的源码。原记录按原 JSON 文件名保存在 [data.json](data.json) 的 records 下；Node 24 结果只作历史记录，不是今后的验收依据。

| 阶段 / 原记录前缀 | 结论与限制 |
| --- | --- |
| `simd-event-mask` | 同步 WASM SIMD 统一识别换行和 UTF-8 偏移，spec −5.40%，小例子 +15.16%；没有达到通用无回退。随后按要求转向纯 JS。 |
| `js-swar-event-mask`、`js-parallel-line-scan` | 字符读取与双 UTF-16 lane 的 JS SWAR 未确立通用加速；并行外观不等于减少字符串读取成本。 |
| `restored-packed-swar` | 还原历史约 7% 收益候选，但包含 LF / 长度分流；不能把它当作通用性已经解决的方案。 |
| `unified-packed-swar` | Buffer 批量复制低字节，统一 LF、CR、CRLF，删除按换行风格分流；仍须完整 UTF-16 确认，且并非所有输入都优于原生搜索。 |
| `structural-swar`、`padded-swar` | 共享扩容、精确尾部容量有简化价值；局部 emit 闭包和早期补齐融合出现扫描回退。后来 segment 方案改变容量编排，应以新报告单独判断。 |
| `fresh-latin1` | 每次 prepare 分配新 Buffer/视图会简化复用状态，但 2–16 KiB 与长行扫描退化；完整解析接近平坦不等于分配免费。 |
| `latin1-profile`、`latin1-inline` | 热点包含字加载、事件确认及 CRLF 前瞻。放宽 V8 预算能使整段 scan 内联；默认预算下拆入口虽可内联，未同时保证吞吐。 |
| `latin1-flow` | bounded-lookahead 改善部分密集扫描，仍有长行不确定性；源码行上的采样不能直接归因为单条 store。 |
| `latin1-prepare-merge` | 用户合并 prepare 的整体改动中，parse 未确立提速，Node 26 密集扫描改善；没有隔离证明单次方法调用是原因。 |
| `latin1-allocation-cleanup`、`latin1-allocation-jit` | 对齐补偿可做语义简化，但旧 Node 24 对照有回退；不能把旧运行时结果套到最新 Node 26 组合。 |
| `block-lines-structure` | 用户统一扫描返回结果和调用流程；历史候选测量曾中断。正确性、入口内联检查不等于对后来实现完成吞吐验收。 |
| `latin1-event-stream`、`latin1-two-loops-review` | 用掩码消费循环代替八 lane 展开明显缩短实现，但独立扫描存在回退；后续 fused-stream 对照才是最近候选报告的基线关系。 |

## 仍有用的不变量

- 低字节镜像不等于 Latin1 输入。`Ċ` / `č`、`上` / `不` 等字符的低字节可能等于 LF / CR；每个命中必须确认原 UTF-16 单元。
- 折叠 `word ^ (word & 0x01010101) * 7 ^ 0x0A0A0A0A` 后各字节均为偶数，因此经典零字节检测的相邻 `0x01` 借位假阳性在该域内不存在。
- 每个真实输入单元最多产生一行；补齐字节不应消耗真实行容量。尾部补齐与把 EOF 伪造成换行是不同方案。
- CRLF 可以跨四字节、八字节及容量分段边界；重新扫描必须清除可复用行表中的旧 State。
- “已内联”“代码更小”“机器指令更少”均不能单独证明吞吐改善。新数据优先于旧机器码推测。

最新的尾部统一、字段掩码与 writeLine 结论见[近期索引](../README.md)。
