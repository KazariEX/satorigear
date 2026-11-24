import type { Yaml } from "mdast";
import { type BlockLines, trimLineWhitespaceStart } from "../../block/lines.ts";
import { BlockKind } from "../../constants/block.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
import type { BlockNodeBuilder } from "../../fragment/block.ts";
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
  const end = lines.end(index);
  return trimLineWhitespaceStart(source, start + 3, end) === end;
}

export function appendYamlBlock(
  source: string,
  lines: BlockLines,
  tokens: BlockTokenStream,
  kind: BlockKind,
  start: number,
  end: number,
): void {
  tokens.push(
    kind,
    lines.start(start),
    lines.end(end - 1),
    {
      value: lines.text(source, start + 1, end - 1),
    },
  );
}

export const buildYamlBlock: BlockNodeBuilder<Yaml> = (tokenStart, context) => {
  const tokens = context.structure.tokens;
  return {
    type: "yaml",
    value: tokens.value<string>(tokenStart)!,
    position: context.locator.positionAt(tokens.start(tokenStart), tokens.end(tokenStart)),
  };
};

export function feature(marker: FrontmatterMarker): SyntaxFeature {
  return {
    block: {
      builds: [
        {
          token: BlockKind.Frontmatter,
          build: buildYamlBlock,
        },
      ],
      starts: [
        {
          codes: [
            marker.charCodeAt(0),
          ],
          start(source, lines, tokens, start, contentOffset, context) {
            if (lines.start(start) !== 0 || !frontmatterFenceAt(source, lines, start, marker)) {
              return;
            }
            for (let end = start + 1; end < lines.length; end++) {
              if (frontmatterFenceAt(source, lines, end, marker)) {
                appendYamlBlock(source, lines, tokens, BlockKind.Frontmatter, start, end + 1);
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
