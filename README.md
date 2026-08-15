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

> Median of 5 isolated mean-time runs at commit [`9570c63`](https://github.com/KazariEX/satorigear/commit/9570c634a28feffd6f437f3544071ff139f16f2f) on Apple M3, node 26.5.0, arm64-darwin. SatoriGear and Sätteri run in paired AB/BA order; comparisons are normalized to SatoriGear (↑ faster, ↓ slower). Lower time and higher throughput are better.

<!-- benchmark:end -->

<!-- benchmark:start parse only -->

<details>
<summary><strong>Parse only</strong></summary>

#### CommonMark

##### CommonMark 0.31.2 specification, 205025 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 2.46 ms | baseline | 79.5 MiB/s |
| Sätteri | 1.13 ms | ↑ 2.17× | 173 MiB/s |
| Remark | 62.0 ms | ↓ 25.00× | 3.16 MiB/s |

##### CommonMark 0.31.2 examples, 14919 bytes, 652 documents

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 1.10 ms | baseline | 13.0 MiB/s |
| Sätteri | 2.70 ms | ↓ 2.46× | 5.28 MiB/s |
| Remark | 26.8 ms | ↓ 24.44× | 0.53 MiB/s |

#### Built-in features

##### Rust release history, 910115 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 24.8 ms | baseline | 35.1 MiB/s |
| Sätteri | 26.6 ms | ↓ 1.07× | 32.7 MiB/s |

##### Public APIs README, 232580 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 7.35 ms | baseline | 30.2 MiB/s |
| Sätteri | 2.41 ms | ↑ 3.06× | 92.2 MiB/s |

</details>

<!-- benchmark:end -->

<!-- benchmark:start fully materialized -->

<details>
<summary><strong>Fully materialized</strong></summary>

#### CommonMark

##### CommonMark 0.31.2 specification, 205025 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 2.50 ms | baseline | 78.1 MiB/s |
| Sätteri | 5.52 ms | ↓ 2.20× | 35.4 MiB/s |
| Remark | 60.2 ms | ↓ 24.11× | 3.25 MiB/s |

##### CommonMark 0.31.2 examples, 14919 bytes, 652 documents

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 1.12 ms | baseline | 12.7 MiB/s |
| Sätteri | 5.91 ms | ↓ 5.30× | 2.41 MiB/s |
| Remark | 26.3 ms | ↓ 23.29× | 0.54 MiB/s |

#### Built-in features

##### Rust release history, 910115 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 25.2 ms | baseline | 34.5 MiB/s |
| Sätteri | 79.8 ms | ↓ 3.20× | 10.9 MiB/s |

##### Public APIs README, 232580 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 7.82 ms | baseline | 28.4 MiB/s |
| Sätteri | 20.8 ms | ↓ 2.66× | 10.7 MiB/s |

</details>

<!-- benchmark:end -->
