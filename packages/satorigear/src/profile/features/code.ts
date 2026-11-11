import {
  appendFencedToken,
  closesFence,
  type Fence,
  fenceAt,
  type FenceRule,
} from "../../block/fence.ts";
import { type BlockLines, isBlankLine, lineIndentOffset, physicalColumnAt } from "../../block/lines.ts";
import { BlockKind } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { inlineMarkerRunEnd } from "../../inline/tokenize.ts";
import { appendInlineToken, inlineTokenData, inlineTokenText } from "../../inline/tokens.ts";
import { semanticText } from "../utils.ts";
import type { SyntaxFeature } from "../types.ts";

const codeFenceRule: FenceRule = {
  alternateMarker: Character.Tilde,
  forbiddenInfoMarker: Character.GraveAccent,
  marker: Character.GraveAccent,
  minimumLength: 3,
};

export function codeFenceAt(
  source: string,
  lines: BlockLines,
  index: number,
  markerOffset: number,
): Fence | undefined {
  return fenceAt(source, lines, index, codeFenceRule, markerOffset);
}

/** Consume structural code indentation before publishing the literal body. */
function indentedContent(source: string, lines: BlockLines, start: number, end: number): string {
  const parts: string[] = [];
  for (let index = start; index < end; index++) {
    let offset = lines.start(index);
    let columns = lines.prefixColumns(index);
    const lineEnd = lines.end(index);
    while (offset < lineEnd && columns < 4) {
      const code = source.charCodeAt(offset);
      if (code === Character.Space) {
        columns++;
      }
      else if (code === Character.CharacterTabulation) {
        columns += Math.max(4 - columns, 4 - physicalColumnAt(source, offset) % 4);
      }
      else {
        break;
      }
      offset++;
    }
    parts.push(" ".repeat(Math.max(0, columns - 4)) + source.slice(offset, lineEnd));
  }
  return parts.join("\n");
}

export const feature: SyntaxFeature = {
  block: {
    builds: [
      {
        token: [
          BlockKind.FencedCodeBlock,
          BlockKind.IndentedCodeBlock,
        ],
        build(tokenStart, context) {
          const tokens = context.structure.tokens;
          const rawInfo = semanticText(tokens.value<string>(tokenStart) ?? "");
          const langEnd = rawInfo.search(/[ \t]/);
          const lang = rawInfo ? langEnd < 0 ? rawInfo : rawInfo.slice(0, langEnd) : null;
          const metaStart = langEnd < 0 ? -1 : rawInfo.slice(langEnd).search(/[^ \t]/);
          return {
            type: "code",
            lang,
            meta: metaStart < 0 ? null : rawInfo.slice(langEnd + metaStart),
            value: tokens.text(context.source, tokenStart),
            position: context.locator.positionAt(tokens.start(tokenStart), tokens.end(tokenStart)),
          };
        },
      },
    ],
    starts: [
      {
        codes: [
          Character.VirtualBlockIndent,
        ],
        start(source, lines, start, contentOffset, out) {
          let end = start + 1;
          while (end < lines.length && lineIndentOffset(source, lines, end) < 0) {
            end++;
          }
          // The block consumes trailing blank lines, but its code value and position do not include them.
          let contentEnd = end;
          while (contentEnd > start && isBlankLine(source, lines, contentEnd - 1)) {
            contentEnd--;
          }
          out.push(BlockKind.IndentedCodeBlock, lines.start(start), lines.end(contentEnd - 1), {
            text: indentedContent(source, lines, start, contentEnd),
          });
          return end;
        },
      },
      {
        codes: [
          Character.GraveAccent,
          Character.Tilde,
        ],
        interrupt(source, lines, index, contentOffset) {
          return !!codeFenceAt(source, lines, index, contentOffset);
        },
        start(source, lines, start, contentOffset, out) {
          const fence = codeFenceAt(source, lines, start, contentOffset);
          if (!fence) {
            return;
          }
          let end = start + 1;
          while (end < lines.length && !closesFence(source, lines, end, fence)) {
            end++;
          }
          const closed = end < lines.length;
          if (end < lines.length) {
            end++;
          }
          appendFencedToken(
            source,
            lines,
            out,
            BlockKind.FencedCodeBlock,
            start,
            end,
            fence,
            closed,
            true,
          );
          return end;
        },
      },
    ],
  },
  inline: {
    scans: [
      {
        marker: Character.GraveAccent,
        scan(source, start, tokens) {
          const openEnd = inlineMarkerRunEnd(source, start);
          if (source.charCodeAt(start - 1) === Character.GraveAccent) {
            return openEnd;
          }
          const markerLength = openEnd - start;
          let offset = openEnd;
          while (offset < source.length) {
            offset = source.indexOf("`", offset);
            if (offset < 0) {
              break;
            }
            const closeEnd = inlineMarkerRunEnd(source, offset);
            if (closeEnd - offset === markerLength) {
              appendInlineToken(tokens, InlineKind.CodeSpan, start, closeEnd, markerLength);
              return closeEnd;
            }
            offset = closeEnd;
          }
          return openEnd;
        },
      },
    ],
    builds: [
      {
        kind: "leaf",
        token: InlineKind.CodeSpan,
        build: (tokenIndex, sourceSpan, context) => {
          const markerLength = inlineTokenData(context.tokens, tokenIndex);
          let value = context.locator.normalizeLineEndings(
            inlineTokenText(context.view.text, context.tokens, tokenIndex, markerLength),
          );
          if (/^[ \n]/.test(value) && /[ \n]$/.test(value) && /[^ \n]/.test(value)) {
            value = value.slice(1, -1);
          }
          return {
            type: "inlineCode",
            value: context.tableCell ? value.replace(/\\\|/g, "|") : value,
            position: sourceSpan,
          };
        },
      },
    ],
  },
};
