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

Benchmarked against Sätteri <sup>0.10.5</sup> and Remark (`mdast-util-from-markdown@2.0.3`), which also produce MDAST, with feature sets kept as equivalent as possible for each profile.

<!-- benchmark:start environment -->

> Median of 4 isolated mean-time runs at commit [`4a11591`](https://github.com/KazariEX/satorigear/commit/4a115917bda739173c14efe45f1ad05987ee74e1) on Apple M3, node 26.5.0, arm64-darwin. SatoriGear and Sätteri run in paired AB/BA order; comparisons are normalized to SatoriGear (↑ faster, ↓ slower). Lower time and higher throughput are better.

<!-- benchmark:end -->

<!-- benchmark:start parse -->

### CommonMark

#### CommonMark 0.31.2 specification, 205025 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 915 µs | baseline | 214 MiB/s |
| Sätteri | 1.19 ms | ↓ 1.30× | 164 MiB/s |
| Remark | 62.4 ms | ↓ 68.22× | 3.13 MiB/s |

#### CommonMark 0.31.2 examples, 14919 bytes, 652 documents

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 589 µs | baseline | 24.2 MiB/s |
| Sätteri | 2.21 ms | ↓ 3.75× | 6.44 MiB/s |
| Remark | 25.6 ms | ↓ 43.53× | 0.56 MiB/s |

### Built-in features

#### Rust release history, 910115 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 13.7 ms | baseline | 63.3 MiB/s |
| Sätteri | 15.0 ms | ↓ 1.09× | 58.0 MiB/s |

#### Public APIs README, 232580 bytes, 1 document

| Engine | Mean time | vs. SatoriGear | Throughput |
| --- | ---: | ---: | ---: |
| **SatoriGear** | 3.26 ms | baseline | 68.0 MiB/s |
| Sätteri | 3.98 ms | ↓ 1.22× | 55.8 MiB/s |

<!-- benchmark:end -->
