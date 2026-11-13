# 由 profile 统一 AST 子节点投影

> 历史报告：文中的“当前”、生产状态和待办仅指该次冻结基线，不代表现在的工作区，也不是新的执行指令。旧 JSON 已合并至 [data.json](data.json) 的 records[原文件名]；源码、bundle、完整日志和已有汇总的逐次观测已裁剪，原文归档描述不再代表文件完整性。

源码提交：7d16f0d — refactor: unify block AST traversal through registered builders。保留依据是更少的分类与特殊遍历，没有已证明的吞吐收益；不更新相对固定 remark 的累计倍数。完整冻结 bundle、源码、构建前快照、所有原始测量见 semantic-build-profile-032e0b3-node26-m1pro.json。

## 一个意图，两类职责

旧模型把两个职责混在 token role 里：结构索引需要知道如何配对 opener/close；AST 遍历又用 BlockOpen/FrameOpen 区分哪些节点可由通用遍历构建。list item、table row/cell、component label 虽然都会产生 AST，却各自手写遍历或单独构建并补插。

新模型中，结构核心只有 Open/Close/Leaf/Raw；现有不可变 builder 注册表决定一个 token 是否产生 AST。没有 builder 的 metadata 不参与 AST 输出，nodeLength 仍决定如何跳过子树。没有添加第二张语义表、运行期状态或新的 feature descriptor。

| 路径 | 原先 | 现在 |
| --- | --- | --- |
| 普通块子节点 | core 检查 role，再查 builder | core 直接查 builder |
| list item / task item | list 手写循环、直接调用 item builder | 注册既有 item builder，使用通用遍历 |
| table row / cell | table 与 row 各有专用循环 | 注册既有 row/cell builder，使用通用遍历 |
| component label | 先单独 build，构建 body 后 unshift | 注册既有 label builder，按源码顺序进入 children |

Parent builder 仍拥有语法语义：list 的 spread、table 的 alignment、component 的名称和 attributes 均由原 feature 解释。component header 为定位 attributes 而跳过 label token 的检查仍保留；删掉的是另行构建与补插 label 的 AST 路径。

FrameOpen 与普通 opener 在结构栈中的处理本来相同；取消 AST role 过滤后，这个分类失去消费者，可以删除。原 FrameOpen kinds 移到 Open 区间，ATX、close、leaf 编号保持不变。不是为了缩短数字或打包字段而重排编号。

BlockNodeBuilder 默认返回 Node，而非仅 RootContent，因为表格单元格等嵌套 MDAST 节点现在也走同一注册表。公开 parser 声明文件逐字节相同。

## 模型边界

生产修改 6 个文件，38 行增加、41 行删除，净减 3 行。新增部分主要是把已有 builder 接入已有注册表；命令式的分类、循环与补插路径减少。

没有减少 token 数，也没有新增 token 字段、metadata、close 内部协议、SourceView、缓存、AST 所有者或增量对应规则。BlockScanContext 仍按行区间扫描，原有显式 close 机制不变。此项统一的是 AST 投影入口，不宣称已经解决未来要研究的 close-token 结构性消除。

## 验证

Generated/source 与强制 CSP 的完整 bundle 测试各 194 项通过，没有新增 parser-private 测试。构建、类型检查、变动文件 lint 通过。

每个后端另外通过：2614 份完整默认语法 AST/position 对照；Rust/API benchmark feature 配置的大语料对照；112 组 component/label/slot/引用嵌套对照与 1440 个实际位置点检查。Edit 作为单独 feature 验证，各有 4608 次对照，无新增差异。

最终 bundle 的 SHA-256 与受测文件相同，公开声明文件与修改前相同。

## 受控性能与限制

所有性能命令使用 taskpolicy -c utility，交替 ABBA/BAAB、独立进程与模块缓存、250ms warmup、GC 后 150ms settling、自然 GC 纳入计时；每组目标 300ms、上限 500ms。最终准入观察共 128 条，含首轮诊断共 160 条，最长 299.30ms。未重跑 remark 性能。

| 最终候选相对基线 | 耗时变化 | 95% CI |
| --- | ---: | --- |
| spec | −0.34% | [−4.40%, +3.89%] |
| 官方例子 | +0.37% | [−2.92%, +3.78%] |
| Rust | −0.84% | [−7.37%, +6.17%] |
| API | +0.66% | [−2.70%, +4.12%] |
| 尾部编辑 | −0.03% | [−3.90%, +4.01%] |
| list 投影密集 | −0.80% | [−7.74%, +6.65%] |
| table 投影密集 | −12.45% | [−40.75%, +29.37%] |
| component 投影密集 | −1.08% | [−3.10%, +0.98%] |

没有已确认提升或回退，跨零不等于精确等价或普遍不回退。保留为模型简化，不能把表格点估计记作收益。

Table worker 在两个版本中都出现约 0.71/0.72ms 与约 1.05ms 两种状态，后者关联更高的 heapBefore 和约 100ms 总 GC，前者约 25/26ms。没有删样本、按 GC 分组作准入、排除 GC 耗时或重跑到有利结果；也没有凭这个相关性认定具体 pretenuring/allocator 原因。该守卫仍有很大不确定性。

首轮 primary.json 属于 role 合并之前的中间版本，且启动时未先观察到并行 typecheck/lint 进程结束，不能排除重叠；完整保留，但不用于准入。final-stock 与 projection-guards 均在所有检查明确 exit 0 后独立运行。

## 下一项独立研究

当前 inline-region discovery 同时依赖 InlineContent flag 和首个子 token 为 InlineChunk。需要独立证明：所有现有 inline owner 都是多 token frame；非 inline owner 不可能直接以 InlineChunk 开始。如果证明成立，可研究删除重复分类。此项尚未实现，没有合并到本提交，也没有性能结论。
