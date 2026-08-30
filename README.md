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

Benchmarked against Sätteri <sup>0.10.5</sup> and Remark (`mdast-util-from-markdown@2.0.3`), which also return eagerly materialized MDAST, with feature sets kept as equivalent as possible for each profile.

<!-- benchmark:start environment -->

> Median of 5 isolated mean-time runs at commit [`d58864a`](https://github.com/KazariEX/satorigear/commit/d58864ae20439752f9200866169c0707547a9a15) on Apple M3, node 26.5.0, arm64-darwin. SatoriGear and Sätteri run in paired AB/BA order; comparisons are normalized to SatoriGear (↑ faster, ↓ slower). Lower time and higher throughput are better.

<!-- benchmark:end -->

<!-- benchmark:start parse -->

### CommonMark

#### CommonMark 0.31.2 specification, 205025 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 955 µs | baseline | 205 MiB/s |
| Sätteri | 1.19 ms | ↓ 1.25× | 164 MiB/s |
| Remark | 62.9 ms | ↓ 65.65× | 3.11 MiB/s |

#### CommonMark 0.31.2 examples, 14919 bytes, 652 documents

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 730 µs | baseline | 19.5 MiB/s |
| Sätteri | 2.21 ms | ↓ 3.03× | 6.44 MiB/s |
| Remark | 25.9 ms | ↓ 35.50× | 0.55 MiB/s |

### Built-in features

#### Rust release history, 910115 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 14.1 ms | baseline | 61.6 MiB/s |
| Sätteri | 14.9 ms | ↓ 1.06× | 58.3 MiB/s |

#### Public APIs README, 232580 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 3.29 ms | baseline | 67.5 MiB/s |
| Sätteri | 3.96 ms | ↓ 1.20× | 56.0 MiB/s |

<!-- benchmark:end -->
