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

> Median of 5 isolated mean-time runs at commit [`e215c32`](https://github.com/KazariEX/satorigear/commit/e215c3230076b908421f36eb027e3d19317b0704) on Apple M3, node 26.5.0, arm64-darwin. SatoriGear and Sätteri run in paired AB/BA order; comparisons are normalized to SatoriGear (↑ faster, ↓ slower). Lower time and higher throughput are better.

<!-- benchmark:end -->

<!-- benchmark:start parse only -->

<details>
<summary><strong>Parse only</strong></summary>

#### CommonMark

##### CommonMark 0.31.2 specification, 205025 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 2.69 ms | baseline | 72.6 MiB/s |
| Sätteri | 1.13 ms | ↑ 2.38× | 173 MiB/s |
| Remark | 63.0 ms | ↓ 22.99× | 3.10 MiB/s |

##### CommonMark 0.31.2 examples, 14919 bytes, 652 documents

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 1.17 ms | baseline | 12.2 MiB/s |
| Sätteri | 2.76 ms | ↓ 2.40× | 5.15 MiB/s |
| Remark | 26.4 ms | ↓ 22.65× | 0.54 MiB/s |

#### Built-in features

##### Rust release history, 910115 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 26.3 ms | baseline | 33.0 MiB/s |
| Sätteri | 26.6 ms | ↓ 1.01× | 32.6 MiB/s |

##### Public APIs README, 232580 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 7.68 ms | baseline | 28.9 MiB/s |
| Sätteri | 2.40 ms | ↑ 3.19× | 92.3 MiB/s |

</details>

<!-- benchmark:end -->

<!-- benchmark:start fully materialized -->

<details>
<summary><strong>Fully materialized</strong></summary>

#### CommonMark

##### CommonMark 0.31.2 specification, 205025 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 2.72 ms | baseline | 71.8 MiB/s |
| Sätteri | 5.50 ms | ↓ 2.03× | 35.6 MiB/s |
| Remark | 60.2 ms | ↓ 22.09× | 3.25 MiB/s |

##### CommonMark 0.31.2 examples, 14919 bytes, 652 documents

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 1.20 ms | baseline | 11.9 MiB/s |
| Sätteri | 6.00 ms | ↓ 5.12× | 2.37 MiB/s |
| Remark | 26.2 ms | ↓ 21.87× | 0.54 MiB/s |

#### Built-in features

##### Rust release history, 910115 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 27.0 ms | baseline | 32.1 MiB/s |
| Sätteri | 79.5 ms | ↓ 2.94× | 10.9 MiB/s |

##### Public APIs README, 232580 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 7.94 ms | baseline | 27.9 MiB/s |
| Sätteri | 20.8 ms | ↓ 2.61× | 10.7 MiB/s |

</details>

<!-- benchmark:end -->
