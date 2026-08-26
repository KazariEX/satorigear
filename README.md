奔走も虚しく、技術・流通を手に入れた地霊殿は、兵器の開発に乗り出した。

その兵器の名は——

<h1 align="center">サトリギア</h1>

<pre align="center">🧪 Working in Progress</pre>

<p align="center">
  <a href="https://www.npmjs.com/package/satorigear"><img
    src="https://img.shields.io/npm/v/satorigear?color=EA7FA0&labelColor=232122"
    alt="[version]"
  ></a>
  <a href="https://www.npmjs.com/package/satorigear"><img
    src="https://img.shields.io/npm/dm/satorigear?color=EA7FA0&labelColor=232122"
    alt="[downloads]"
  ></a>
  <a href="https://github.com/KazariEX/satorigear/blob/main/LICENSE"><img
    src="https://img.shields.io/github/license/KazariEX/satorigear?color=EA7FA0&labelColor=232122"
    alt="[license]"
  ></a>
</p>

SatoriGear is a blazing fast markdown parser with full incremental support that outputs MDAST.

It includes built-in support for GFM and MDC syntax and is fully compliant with the CommonMark specification. The plugin API is not yet public.

## Installation

```bash
pnpm i satorigear
```

## Usage

```ts
import { createParser } from "satorigear";

const parser = createParser({
  features: {
    attributes: true,
    binding: true,
    component: true,
    emoji: true,
    footnote: true,
    frontmatter: true,
    math: true,
    strikethrough: true,
    table: true,
    taskList: true,
  },
});

// one-shot parse
const mdast = parser.parse("...");

// incremental edit
const document = parser.createDocument("...");
document.edit([
  { start: 66, end: 66, text: ":" },
  { start: 67, end: 67, text: "nuxt-img" },
]);
const mdast = document.tree;
```

## Performance

Benchmarked against Sätteri and Remark, which also produce MDAST, with feature sets kept as equivalent as possible for each profile. Since Sätteri's `markdownToMdast` returns a lazily materialized tree, parse-only and fully materialized results are reported separately.

<!-- benchmark:start environment -->

> Median of 5 isolated mean-time runs at commit [`ed5362d`](https://github.com/KazariEX/satorigear/commit/ed5362d7e1ff096c6ac5c8c8fd9933a4316379fe) on Apple M3, node 26.5.0, arm64-darwin. SatoriGear and Sätteri run in paired AB/BA order; comparisons are normalized to SatoriGear (↑ faster, ↓ slower). Lower time and higher throughput are better.

<!-- benchmark:end -->

<!-- benchmark:start parse only -->

<details>
<summary><strong>Parse only</strong></summary>

#### CommonMark

##### CommonMark 0.31.2 specification, 205025 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 1.35 ms | baseline | 145 MiB/s |
| Sätteri | 1.12 ms | ↑ 1.20× | 174 MiB/s |
| Remark | 62.4 ms | ↓ 46.33× | 3.13 MiB/s |

##### CommonMark 0.31.2 examples, 14919 bytes, 652 documents

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 913 µs | baseline | 15.6 MiB/s |
| Sätteri | 2.69 ms | ↓ 2.95× | 5.28 MiB/s |
| Remark | 26.2 ms | ↓ 28.75× | 0.54 MiB/s |

#### Built-in features

##### Rust release history, 910115 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 17.9 ms | baseline | 48.6 MiB/s |
| Sätteri | 26.5 ms | ↓ 1.48× | 32.7 MiB/s |

##### Public APIs README, 232580 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 3.96 ms | baseline | 56.1 MiB/s |
| Sätteri | 2.40 ms | ↑ 1.65× | 92.5 MiB/s |

</details>

<!-- benchmark:end -->

<!-- benchmark:start fully materialized -->

<details>
<summary><strong>Fully materialized</strong></summary>

#### CommonMark

##### CommonMark 0.31.2 specification, 205025 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 1.42 ms | baseline | 138 MiB/s |
| Sätteri | 5.48 ms | ↓ 3.86× | 35.7 MiB/s |
| Remark | 60.0 ms | ↓ 42.40× | 3.26 MiB/s |

##### CommonMark 0.31.2 examples, 14919 bytes, 652 documents

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 940 µs | baseline | 15.1 MiB/s |
| Sätteri | 5.88 ms | ↓ 6.27× | 2.42 MiB/s |
| Remark | 26.1 ms | ↓ 27.80× | 0.54 MiB/s |

#### Built-in features

##### Rust release history, 910115 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 18.8 ms | baseline | 46.1 MiB/s |
| Sätteri | 79.6 ms | ↓ 4.23× | 10.9 MiB/s |

##### Public APIs README, 232580 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 4.36 ms | baseline | 50.8 MiB/s |
| Sätteri | 20.7 ms | ↓ 4.75× | 10.7 MiB/s |

</details>

<!-- benchmark:end -->
