import { decodeString } from "micromark-util-decode-string";
import { createFencedBlock } from "../../block/fence.ts";
import {
  type BlockLines,
  isBlankLine,
  lineIndentOffset,
  physicalColumnAt,
  trimLineWhitespaceStart,
} from "../../block/lines.ts";
import { BlockKind } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { inlineMarkerRunEnd } from "../../inline/tokenizer.ts";
import { appendInlineToken, inlineTokenData, inlineTokenText } from "../../inline/tokens.ts";
import { hasInlinePadding, semanticText } from "../utils.ts";
import type { SyntaxFeature } from "../types.ts";

const complexInfo = /[\\& \t]/;
const separator = /[ \t]/;

const backtickFence = createFencedBlock({
  kind: BlockKind.FencedCodeBlock,
  marker: Character.GraveAccent,
  minimumLength: 3,
  allowMarkerInInfo: false,
});

const tildeFence = createFencedBlock({
  kind: BlockKind.FencedCodeBlock,
  marker: Character.Tilde,
  minimumLength: 3,
  allowMarkerInInfo: true,
});

export function codeFenceClosingLine(
  source: string,
  lines: BlockLines,
  open: number,
  limit: number,
  offset: number,
): number | undefined {
  const marker = source.charCodeAt(offset);
  if (marker === Character.GraveAccent) {
    return backtickFence.closingLineAt(source, lines, open, limit, offset);
  }
  if (marker === Character.Tilde) {
    return tildeFence.closingLineAt(source, lines, open, limit, offset);
  }
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
          let info = tokens.value<string>(tokenStart) ?? "";
          let langEnd = info.search(complexInfo);
          if (langEnd >= 0) {
            const code = info.charCodeAt(langEnd);
            if (code === Character.Space || code === Character.CharacterTabulation) {
              // Decoding the suffix leaves the first delimiter at its original offset.
              info = semanticText(info);
            }
            else {
              info = decodeString(info);
              langEnd = info.search(separator);
            }
          }
          return {
            type: "code",
            lang: langEnd >= 0 ? info.slice(0, langEnd) : info || null,
            meta: langEnd >= 0 && info.slice(trimLineWhitespaceStart(info, langEnd, info.length)) || null,
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
        start(source, lines, tokens, start) {
          let end = start + 1;
          while (end < lines.length && lineIndentOffset(source, lines, end) < 0) {
            end++;
          }
          // Trailing blanks are consumed outside the code span. Its opening line already has content.
          let contentEnd = end;
          while (contentEnd > start + 1 && isBlankLine(source, lines, contentEnd - 1)) {
            contentEnd--;
          }
          tokens.push(BlockKind.IndentedCodeBlock, lines.start(start), lines.end(contentEnd - 1), {
            text: indentedContent(source, lines, start, contentEnd),
          });
          return end;
        },
      },
      backtickFence,
      tildeFence,
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
        build: (tokenIndex, position, context) => {
          const markerLength = inlineTokenData(context.tokens, tokenIndex);
          const text = context.locator.normalizeLineEndings(
            inlineTokenText(context.view.text, context.tokens, tokenIndex, markerLength),
          );
          const value = hasInlinePadding(text) ? text.slice(1, -1) : text;
          return {
            type: "inlineCode",
            value: context.tableCell ? value.replaceAll("\\|", "|") : value,
            position,
          };
        },
      },
    ],
  },
};
