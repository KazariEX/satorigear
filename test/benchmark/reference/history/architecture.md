# 块解析架构实验摘要

合并原 `container-stack-design.md`、`single-row-parser-model.md`、`block-frame-research.md`。这是历史设计与已撤回实验，不是待自动执行的计划。结构化结果保存在 [data.json](data.json)，主要记录包括 `unified-block-ranges-node26-m1pro.json`、`architecture-attribution-4a9c16d-node26-m1pro.json` 和 `structural-research-6adec02-node26-m1pro.json`。

## 容器按物理行推进

让当前物理行依次经过活动容器，再进入叶子，可以减少“容器深度 × 行数”的投影几何写入。但原 BlockStart 是同步拉取、整块消费协议；逐行驱动需要可暂停的容器状态、continuation 与 lazy 规则，不能只换扫描循环。quote、list、footnote 的缩进规则仍归各语法所有。

现有 SourceView 只投影文本和坐标，行表还携带 lazy continuation 与虚拟 Tab 列数。相同投影文本不保证相同解析结果，例如 `> a\n===` 与 `> a\n> ===`。详见[边界反例与实际字符串布局](source-projection-boundaries.md)。删除坐标表前必须明确这些语义由谁持有，不能靠重新拼字符串隐式抹掉。

## 直接生成块 AST 的 v15 实验

冻结在 `4a9c16d` 基线的完整替换涉及 39 个源码路径，净少 1,722 行，bundle 163,248 → 142,704 字节。它减少了块级中间表示，却增加了增量生命周期、游标 fork/adopt 和复用证明的负担；并未通过性能准入，生产实现已在当时恢复。

它也不是完全单遍解析：前向定义仍要求先收集定义再做 inline；raw/resolved tokens、投影映射、任务与增量缓存仍存在。bundle 减少不能当作堆内存同比减少。早期统一块范围候选还出现消费/追加双职责、隐式 span 模式及 metadata 所有权扩散，不能以净减行数替代模型简化。

## 更窄的后续结论

[行输入研究](line-input-architecture.md)只改变四字段行表的建立时机，最终仍建立 9,756 行、写入 39,024 字段，增加暂停和可用性检查；没有省掉原工作量，未通过验收。

[字面量内容与借用行范围](literal-content-and-line-range-ownership.md)则把已知内容交给块扫描阶段，并让只读扫描借用范围、编辑继续独立持有副本。其历史 Q 与 Q+D 必须区分：Q 的中部编辑回退不能用后来 D 的结论覆盖。所有性能数字只属于各自冻结版本。
