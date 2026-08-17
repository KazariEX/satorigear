import type { Yaml } from "mdast";
import { type BlockLine, normalizeLines } from "../../block/lines.ts";
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
  line: BlockLine,
  marker: FrontmatterMarker,
): boolean {
  if (
    source[line.start] !== marker ||
    source[line.start + 1] !== marker ||
    source[line.start + 2] !== marker
  ) {
    return false;
  }
  for (let offset = line.start + 3; offset < line.end; offset++) {
    if (source[offset] !== " " && source[offset] !== "\t") {
      return false;
    }
  }
  return true;
}

export const buildFrontmatter: BlockNodeBuilder<Yaml> = (tokenStart, context) => {
  const tokens = context.structure.tokens;
  const rangeCount = tokens.rangeCount(tokenStart);
  if (rangeCount < 2) {
    throw new Error("YAML token does not contain two fences");
  }
  let value = normalizeLines(context.source.slice(
    tokens.rangeEnd(tokenStart, 0),
    tokens.rangeStart(tokenStart, rangeCount - 1),
  ));
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
      restart(source, lines, changedStart) {
        const opening = lines[0];
        if (!opening) {
          return;
        }
        if (!frontmatterFenceAt(source, opening, marker)) {
          return changedStart < opening.next ? 0 : void 0;
        }
        for (let index = 1; index < lines.length; index++) {
          if (frontmatterFenceAt(source, lines[index], marker)) {
            return changedStart < lines[index].next ? 0 : void 0;
          }
        }
        return 0;
      },
      rules: [
        {
          rule: BlockRule.Frontmatter,
          syntax: {
            kind: "leaf",
            token: BlockKind.FrontmatterToken,
          },
          build: buildFrontmatter,
        },
      ],
      starts: [
        {
          codes: [marker.charCodeAt(0)],
          start(source, lines, start, out) {
            if (lines[start].start !== 0 || !frontmatterFenceAt(source, lines[start], marker)) {
              return;
            }
            for (let end = start + 1; end < lines.length; end++) {
              if (frontmatterFenceAt(source, lines[end], marker)) {
                appendLogicalToken(out, BlockKind.FrontmatterToken, source, lines, start, end + 1);
                return end + 1;
              }
            }
          },
        },
      ],
    },
  };
}
