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
const mdast = document.snapthot();
```

## Performance

Benchmarked against Sätteri and Remark, which also produce MDAST, with feature sets kept as equivalent as possible for each profile. Since Sätteri's `markdownToMdast` returns a lazily materialized tree, parse-only and fully materialized results are reported separately.

<!-- benchmark:start environment -->

> Median of 5 isolated mean-time runs at commit [`deacb94`](https://github.com/KazariEX/satorigear/commit/deacb94abb22839aa84f32374cf348cfa27332e1) on Apple M3, node 26.5.0, arm64-darwin. SatoriGear and Sätteri run in paired AB/BA order; comparisons are normalized to SatoriGear (↑ faster, ↓ slower). Lower time and higher throughput are better.

<!-- benchmark:end -->

<!-- benchmark:start parse only -->

<details>
<summary><strong>Parse only</strong></summary>

#### CommonMark

##### CommonMark 0.31.2 specification, 205025 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 2.32 ms | baseline | 84.2 MiB/s |
| Sätteri | 1.12 ms | ↑ 2.07× | 174 MiB/s |
| Remark | 62.8 ms | ↓ 26.86× | 3.11 MiB/s |

##### CommonMark 0.31.2 examples, 14919 bytes, 652 documents

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 1.03 ms | baseline | 13.9 MiB/s |
| Sätteri | 2.71 ms | ↓ 2.64× | 5.25 MiB/s |
| Remark | 26.6 ms | ↓ 25.96× | 0.53 MiB/s |

#### Built-in features

##### Rust release history, 910115 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 21.9 ms | baseline | 39.6 MiB/s |
| Sätteri | 26.7 ms | ↓ 1.22× | 32.5 MiB/s |

##### Public APIs README, 232580 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 5.49 ms | baseline | 40.4 MiB/s |
| Sätteri | 2.40 ms | ↑ 2.28× | 92.4 MiB/s |

</details>

<!-- benchmark:end -->

<!-- benchmark:start fully materialized -->

<details>
<summary><strong>Fully materialized</strong></summary>

#### CommonMark

##### CommonMark 0.31.2 specification, 205025 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 2.34 ms | baseline | 83.4 MiB/s |
| Sätteri | 5.47 ms | ↓ 2.33× | 35.7 MiB/s |
| Remark | 59.9 ms | ↓ 25.53× | 3.27 MiB/s |

##### CommonMark 0.31.2 examples, 14919 bytes, 652 documents

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 1.05 ms | baseline | 13.6 MiB/s |
| Sätteri | 5.92 ms | ↓ 5.57× | 2.41 MiB/s |
| Remark | 26.3 ms | ↓ 25.07× | 0.54 MiB/s |

#### Built-in features

##### Rust release history, 910115 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 22.1 ms | baseline | 39.2 MiB/s |
| Sätteri | 79.5 ms | ↓ 3.59× | 10.9 MiB/s |

##### Public APIs README, 232580 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 5.76 ms | baseline | 38.5 MiB/s |
| Sätteri | 21.0 ms | ↓ 3.63× | 10.6 MiB/s |

</details>

<!-- benchmark:end -->
