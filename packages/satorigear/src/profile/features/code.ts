import { decodeString } from "micromark-util-decode-string";
import { createFence } from "../../block/fence.ts";
import {
  type BlockLines,
  isBlankLine,
  lineIndentOffset,
  physicalColumnAt,
  trimLineWhitespaceStart,
} from "../../block/lines.ts";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { inlineMarkerRunEnd } from "../../inline/tokenizer.ts";
import { appendInlineToken, inlineTokenData, inlineTokenText } from "../../inline/tokens.ts";
import { hasInlinePadding, semanticText } from "../utils.ts";
import type { BlockStartRegistration } from "../../block/profile.ts";
import type { SyntaxFeature } from "../types.ts";

const complexInfo = /[\\& \t]/g;
const separator = /[ \t]/g;

const backtickFence = createFence({
  marker: Character.GraveAccent,
  minimumLength: 3,
  normalizeEndings: true,
  allowMarkerInInfo: false,
});

const tildeFence = createFence({
  marker: Character.Tilde,
  minimumLength: 3,
  normalizeEndings: true,
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
          while (end > start + 1 && isBlankLine(source, lines, end - 1)) {
            end--;
          }
          return {
            node: {
              type: "code",
              lang: null,
              meta: null,
              value: indentedContent(source, lines, start, end),
              position: void 0,
            },
            nextLine: end,
            start: lines.start(start),
            end: lines.end(end - 1),
          };
        },
      },
      ...[backtickFence, tildeFence].map<BlockStartRegistration>((fence) => ({
        codes: fence.codes,
        interrupt: fence.interrupt,
        start(source, lines, tokens, start, offset) {
          const match = fence.match(source, lines, start, offset);
          if (!match) {
            return;
          }
          let info = match.info;
          complexInfo.lastIndex = 0;
          let langEnd = complexInfo.test(info) ? complexInfo.lastIndex - 1 : -1;
          if (langEnd >= 0) {
            const code = info.charCodeAt(langEnd);
            if (code === Character.Space || code === Character.CharacterTabulation) {
              // Decoding the suffix leaves the first delimiter at its original offset.
              info = semanticText(info);
            }
            else {
              info = decodeString(info);
              separator.lastIndex = langEnd;
              langEnd = separator.test(info) ? separator.lastIndex - 1 : -1;
            }
          }
          return {
            node: {
              type: "code",
              lang: langEnd >= 0 ? info.slice(0, langEnd) : info || null,
              meta: langEnd >= 0 && info.slice(trimLineWhitespaceStart(info, langEnd, info.length)) || null,
              value: match.value,
              position: void 0,
            },
            nextLine: match.nextLine,
            start: offset,
            end: match.end,
          };
        },
      })),
    ],
  },
  inline: {
    scans: [
      {
        marker: Character.GraveAccent,
        scan(source, start, tokens) {
          const openEnd = inlineMarkerRunEnd(source, start, Character.GraveAccent);
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
            const closeEnd = inlineMarkerRunEnd(source, offset, Character.GraveAccent);
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
