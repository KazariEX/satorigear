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
  { start: 66, end: 66, text: "nuxt-img" },
]);
const mdast = document.tree;
```

## Performance

Benchmarked against Sätteri <sup>0.11.1</sup> and Remark (`mdast-util-from-markdown@2.0.3`), which also produce MDAST, with feature sets kept as equivalent as possible for each profile.

<!-- benchmark:start environment -->

> Median of 4 isolated mean-time runs at commit [`0b66e96`](https://github.com/KazariEX/satorigear/commit/0b66e96a87d5f6798b2bc360a300c32629f89a8e) on AMD EPYC 9V45 96-Core Processor, node 22.23.4, x64-linux. SatoriGear and Sätteri run in paired AB/BA order; comparisons are normalized to SatoriGear (↑ faster, ↓ slower). Lower time and higher throughput are better.

<!-- benchmark:end -->

<!-- benchmark:start parse -->

### CommonMark

#### CommonMark 0.31.2 specification, 205025 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 2.31 ms | baseline | 84.5 MiB/s |
| Sätteri | 1.85 ms | ↑ 1.25× | 105 MiB/s |
| Remark | 117 ms | ↓ 50.45× | 1.67 MiB/s |

#### CommonMark 0.31.2 examples, 14919 bytes, 652 documents

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 1.55 ms | baseline | 9.17 MiB/s |
| Sätteri | 2.28 ms | ↓ 1.47× | 6.25 MiB/s |
| Remark | 53.3 ms | ↓ 34.35× | 0.27 MiB/s |

### Built-in features

#### Rust release history, 910115 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 26.4 ms | baseline | 32.8 MiB/s |
| Sätteri | 22.4 ms | ↑ 1.18× | 38.8 MiB/s |

#### Public APIs README, 232580 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 5.80 ms | baseline | 38.3 MiB/s |
| Sätteri | 5.66 ms | ↑ 1.02× | 39.2 MiB/s |

<!-- benchmark:end -->
