import type { Yaml } from "mdast";
import { type BlockLines, normalizeLines } from "../../block/lines.ts";
import { appendLogicalToken } from "../../block/tokens.ts";
import { BlockKind, BlockRule } from "../../constants/block.ts";
import { blockEnd, type BlockNodeBuilder } from "../../fragment/block.ts";
import type { SyntaxFeature } from "../types.ts";

export type FrontmatterMarker = "+" | "-";

export interface FrontmatterOptions {
  marker: FrontmatterMarker;
}

function frontmatterFenceAt(
  source: string,
  lines: BlockLines,
  index: number,
  marker: FrontmatterMarker,
): boolean {
  const start = lines.start(index);
  if (
    source[start] !== marker ||
    source[start + 1] !== marker ||
    source[start + 2] !== marker
  ) {
    return false;
  }
  for (let offset = start + 3, end = lines.end(index); offset < end; offset++) {
    if (source[offset] !== " " && source[offset] !== "\t") {
      return false;
    }
  }
  return true;
}

export const buildFrontmatter: BlockNodeBuilder<Yaml> = (tokenStart, context) => {
  const tokens = context.structure.tokens;
  const text = normalizeLines(tokens.text(context.source, tokenStart));
  const contentStart = text.indexOf("\n") + 1;
  const closingEnd = text.endsWith("\n") ? text.length - 1 : text.length;
  const closingStart = text.lastIndexOf("\n", closingEnd - 1) + 1;
  let value = text.slice(contentStart, closingStart);
  if (value.endsWith("\n")) {
    value = value.slice(0, -1);
  }
  return {
    type: "yaml",
    value,
    position: {
      start: tokens.start(tokenStart),
      end: blockEnd(tokenStart, context),
    },
  };
};

export function feature(marker: FrontmatterMarker): SyntaxFeature {
  return {
    block: {
      rules: [
        {
          rule: BlockRule.Frontmatter,
          syntax: {
            kind: "leaf",
            token: BlockKind.Frontmatter,
          },
          build: buildFrontmatter,
        },
      ],
      starts: [
        {
          codes: [marker.charCodeAt(0)],
          start(source, lines, start, contentOffset, out, context) {
            if (lines.start(start) !== 0 || !frontmatterFenceAt(source, lines, start, marker)) {
              return;
            }
            for (let end = start + 1; end < lines.length; end++) {
              if (frontmatterFenceAt(source, lines, end, marker)) {
                appendLogicalToken(out, BlockKind.Frontmatter, source, lines, start, end + 1);
                return end + 1;
              }
            }
            // A closing fence appended after this failed probe can reinterpret the document from offset 0.
            context.retainLookahead(lines.next(lines.length - 1));
          },
        },
      ],
    },
  };
}
