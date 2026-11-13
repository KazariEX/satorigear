# writeLine 提取性能 — Node 26

> 冻结实验记录（2026-11-15，Node 26.13.0 / M1 Pro）。文中工作区状态仅指测量时的快照。全部配对观测保留；JSON 中的 `$text` 在 [reproduction.json](reproduction.json) 的 texts 下按 SHA-256 查找。完整反汇编已裁剪，保留日志摘要、关键片段和原内容哈希。

当前函数声明形式的 writeLine 被 V8 内联，但内联后仍存在调用目标检查。隔离提取本身的配对测试，在多个扫描场景测得小幅回退，连续换行压力场景的回退在正反两种语料顺序下均重现。用户源码和暂存区未修改。

## 三个版本

- baseline：本轮开始时暂存区的 lines.ts。
- inline：保留当前所有其他更改，仅删除 writeLine 定义，并将三个调用点展开为完全相同的四次位或索引写入及掩码计数。Index0 同样保留当前掩码和索引语义。
- helper：当前工作区原样源码。

inline → helper 隔离函数提取的影响；baseline → helper 测量整份未暂存更改的端到端影响。当前 diff 还包含 allocate 命名、for 更新表达式、wordEnd 比较、多处索引改为位或等，不能把整体差异全归给函数提取。尤其 cursor > limit - available 与旧条件在等号处不同，可能改变尾块分段；有效行行为验证通过。

## 方法

Node 26.13.0 / V8 14.6.202.34-node.40 / Apple M1 Pro arm64。所有计时进程串行，不带 V8 日志标志。扫描用 11 项常规和 7 项压力语料，各按正序、反序执行；每组四个 ABBA/BAAB 块，共 16 个独立进程。每项覆盖 N..N+7、复用行表与缓冲区、包含 Latin1 复制；100 ms 预热、GC、50 ms 稳定、200 ms 自然 GC 计时。每次操作扫描八份输入。

两组端到端比较分别用八个 ABBA/BAAB 块，共 32 个独立进程，运行原样 benchmark:parse，仅用加载钩子切换冻结 satorigear 构建。BENCHMARK_ENGINE=satorigear，保留 Mitata 默认设置。总计 128 个独立计时进程。

下表为 helper 相对相应基线的耗时变化；正数表示当前 helper 更慢，负数表示更快。方括号为逐项 95% 配对区间，跨零不等于证明相等。

## 隔离 writeLine 提取：扫描

| 场景 | 正序 | 反序 |
|---|---:|---:|
| 256/control | +1.48% [-3.69, +6.93] | -0.30% [-7.98, +8.02] |
| 2KiB/lines32/all-tails | +1.16% [-0.04, +2.37] | +1.24% [+0.58, +1.91] |
| 16KiB/lines32/all-tails | +0.97% [+0.29, +1.65] | +1.07% [+0.31, +1.84] |
| 1MiB/lines32/all-tails | +0.37% [-0.25, +0.99] | +0.90% [+0.41, +1.40] |
| 1MiB/unicode/all-tails | +3.20% [+2.32, +4.09] | -0.18% [-1.00, +0.64] |
| 1MiB/long-lines/all-tails | +0.49% [-0.18, +1.16] | -0.16% [-0.68, +0.35] |
| 1MiB/dense/all-tails | +1.96% [+1.40, +2.52] | +0.52% [-2.00, +3.11] |
| 16KiB/LF/all-tails | +1.12% [+0.77, +1.48] | +1.04% [+0.19, +1.89] |
| 16KiB/CR/all-tails | +1.03% [-0.10, +2.18] | -7.74% [-8.91, -6.57] |
| 16KiB/CRLF/all-tails | +0.70% [+0.17, +1.23] | +0.83% [+0.20, +1.46] |
| 1MiB/no-endings/all-tails | -0.08% [-0.75, +0.58] | -0.11% [-0.52, +0.31] |
| 16KiB/all-LF | +4.57% [+3.94, +5.20] | +4.49% [+3.93, +5.05] |
| 16KiB/all-CR | +4.00% [+3.83, +4.16] | +5.68% [+3.90, +7.50] |
| 16KiB/all-CRLF | +2.68% [+1.78, +3.59] | +3.62% [+2.41, +4.84] |
| 64KiB/all-aliases | +2.81% [+0.79, +4.87] | -0.46% [-3.62, +2.82] |
| 64KiB/Unicode-no-endings | +0.56% [-0.25, +1.37] | +1.62% [+0.12, +3.15] |
| 64KiB/control-no-endings | -0.00% [-0.50, +0.49] | +1.67% [+0.99, +2.36] |
| 64KiB/varied-widths | +0.56% [+0.28, +0.83] | +1.66% [+0.03, +3.32] |

连续 LF/CR/CRLF 的两种顺序都支持提取后变慢。普通 2 KiB、16 KiB 与 LF/CRLF 行也多偏慢。反序普通 CR 行更快约 7.74%，保留此反例；部分 Unicode、无换行和别名结果也随顺序变化。不能把一个额外检查认定为全部差异的唯一成因。

## benchmark:parse

| 比较 | 场景 | 耗时变化及 95% 区间 |
|---|---|---:|
| 仅提取 writeLine | satorigear, parse (CommonMark 0.31.2 specification, 205025 bytes, 1 document) | +0.30% [-0.57, +1.19] |
| 仅提取 writeLine | satorigear, parse (CommonMark 0.31.2 examples, 14919 bytes, 652 documents) | +1.08% [+0.08, +2.10] |
| 当前全部更改 vs 暂存版 | satorigear, parse (CommonMark 0.31.2 specification, 205025 bytes, 1 document) | +0.15% [-0.36, +0.66] |
| 当前全部更改 vs 暂存版 | satorigear, parse (CommonMark 0.31.2 examples, 14919 bytes, 652 documents) | +0.33% [-0.39, +1.06] |

## V8 证据

日志明确记录 writeLine 内联进入 Latin1.scan、Index0.scan 以及包含 Index0 的调用者。普通 Latin1 内核从 6872 → 6648 字节、8848 → 8656 字节；OSR 版本从 12824 → 13024 字节。函数已内联和代码总体缩小，都不等于没有运行成本。

helper 常规内核的每行写入前多出函数目标检查，代表性片段：

```asm
ldur x4, [x2, #55]
cmp  x4, x3
b.ne deopt_wrong_call_target
```

分支目标在 V8 反汇编中被标注为 wrong call target；对应常量加载明确指向 JSFunction writeLine。内联展开版在相同四次行字段写入之前没有这组检查。之后还存在函数常量重载。这个开销有直接机器码依据，但本轮没有通过消除该检查的第三个候选作因果干预，因此不将所有耗时差异单独归因于它。

## 验证与归档

inline 与 helper 分别通过 13,408 次行几何、1,310 次 AST/位置、720 次增量编辑对比，以及 43,730 项尾部/UTF-16/精确容量检查；公共词检测校验 696,864 项。

源码、暂存区和原有未暂存 diff 与开始时一致。报告未暂存。同名 JSON 保存三份源码、构建哈希、全部配对观测、harness 和日志摘要；缓存及完整 V8 日志位于 node_modules/.cache/write-line-perf-20261115/。
