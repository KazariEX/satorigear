import type { Yaml } from "mdast";
import { logicalToken, tokenStart } from "../../block/tokens.ts";
import {
  blockEnd,
  blockToken,
  normalizeLines,
} from "../../fragment/block.ts";
import { withSpan } from "../../fragment/node.ts";
import type { BlockLine } from "../../block/lines.ts";
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
          rule: "Frontmatter",
          syntax: {
            kind: "leaf",
            token: "FrontmatterToken",
          },
          build(nodeId, offset, tokenBase, context) {
            const token = blockToken(nodeId, tokenBase, "FrontmatterToken", context);
            const ranges = token.ranges;
            if (!ranges || ranges.length < 2) {
              throw new Error("FrontmatterToken does not contain two fences");
            }
            let value = normalizeLines(context.source.slice(ranges[0].end, ranges.at(-1)!.offset));
            if (value.endsWith("\n")) {
              value = value.slice(0, -1);
            }
            return withSpan<Yaml>(
              { type: "yaml", value },
              tokenStart(token),
              blockEnd(nodeId, offset, context),
            );
          },
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
                out.push(logicalToken("FrontmatterToken", source, lines, start, end + 1));
                return end + 1;
              }
            }
          },
        },
      ],
    },
  };
}
