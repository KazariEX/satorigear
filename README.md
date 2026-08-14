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
    footnote: true,
    frontmatter: true,
    math: true,
    strikethrough: true,
    table: true,
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
const mdast = document.snapthot();
```

## Performance

Benchmarked against Sätteri and Remark, which also produce MDAST, with feature sets kept as equivalent as possible for each profile. Since Sätteri's `markdownToMdast` returns a lazily materialized tree, parse-only and fully materialized results are reported separately.

<!-- benchmark:start environment -->

> Median of 5 mean-time runs at commit [`8055594`](https://github.com/KazariEX/satorigear/commit/8055594e0e201567e975453a991c81a62a90bce7) on Apple M3, node 26.5.0, arm64-darwin. Comparisons are relative to SatoriGear (↑ faster, ↓ slower); lower time and higher throughput are better.

<!-- benchmark:end -->

<!-- benchmark:start parse only -->

<details>
<summary><strong>Parse only</strong></summary>

#### CommonMark

##### CommonMark 0.31.2 specification, 205025 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 2.62 ms | baseline | 74.6 MiB/s |
| Sätteri | 1.12 ms | ↑ 2.34× | 175 MiB/s |
| Remark | 63.1 ms | ↓ 24.08× | 3.10 MiB/s |

##### CommonMark 0.31.2 examples, 14919 bytes, 652 documents

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 1.23 ms | baseline | 11.6 MiB/s |
| Sätteri | 2.74 ms | ↓ 2.23× | 5.20 MiB/s |
| Remark | 27.0 ms | ↓ 22.02× | 0.53 MiB/s |

#### Built-in features

##### Rust release history, 910115 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 28.0 ms | baseline | 31.1 MiB/s |
| Sätteri | 26.6 ms | ↑ 1.05× | 32.6 MiB/s |

##### Public APIs README, 232580 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 8.14 ms | baseline | 27.3 MiB/s |
| Sätteri | 2.41 ms | ↑ 3.38× | 92.2 MiB/s |

</details>

<!-- benchmark:end -->

<!-- benchmark:start fully materialized -->

<details>
<summary><strong>Fully materialized</strong></summary>

#### CommonMark

##### CommonMark 0.31.2 specification, 205025 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 2.73 ms | baseline | 71.7 MiB/s |
| Sätteri | 5.49 ms | ↓ 2.01× | 35.6 MiB/s |
| Remark | 60.0 ms | ↓ 22.01× | 3.26 MiB/s |

##### CommonMark 0.31.2 examples, 14919 bytes, 652 documents

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 1.28 ms | baseline | 11.1 MiB/s |
| Sätteri | 5.93 ms | ↓ 4.63× | 2.40 MiB/s |
| Remark | 27.1 ms | ↓ 21.12× | 0.53 MiB/s |

#### Built-in features

##### Rust release history, 910115 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 28.1 ms | baseline | 30.9 MiB/s |
| Sätteri | 77.3 ms | ↓ 2.75× | 11.2 MiB/s |

##### Public APIs README, 232580 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 8.84 ms | baseline | 25.1 MiB/s |
| Sätteri | 20.9 ms | ↓ 2.36× | 10.6 MiB/s |

</details>

<!-- benchmark:end -->
