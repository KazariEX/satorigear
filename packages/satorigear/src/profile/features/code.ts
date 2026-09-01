import {
  closesFence,
  type Fence,
  fenceAt,
  fencedBlock,
  type FencedBlock,
  type FenceRule,
  normalizedFenceContent,
} from "../../block/fence.ts";
import { type BlockLines, isBlank, lineIndentOffset, removeIndent } from "../../block/lines.ts";
import { appendLogicalToken } from "../../block/tokens.ts";
import { BlockKind } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { fencedBlockPosition } from "../../fragment/block.ts";
import { inlineMarkerRunEnd } from "../../inline/lexer.ts";
import { appendInlineToken, inlineTokenData, inlineTokenText } from "../../inline/tokens.ts";
import { semanticText } from "./text.ts";
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

export const feature: SyntaxFeature = {
  block: {
    builds: [
      {
        token: BlockKind.FencedCodeBlock,
        build(tokenStart, context) {
          const tokens = context.structure.tokens;
          // The fenced-code scanner records geometry on every emitted block token.
          const block = tokens.value<FencedBlock>(tokenStart)!;
          const source = context.locator.normalizeLineEndings(
            block.content ?? tokens.text(context.source, tokenStart),
          );
          const rawInfo = semanticText(block.info);
          const langEnd = rawInfo.search(/[ \t]/);
          const lang = rawInfo ? langEnd < 0 ? rawInfo : rawInfo.slice(0, langEnd) : null;
          const metaStart = langEnd < 0 ? -1 : rawInfo.slice(langEnd).search(/[^ \t]/);
          return {
            type: "code",
            lang,
            meta: metaStart < 0 ? null : rawInfo.slice(langEnd + metaStart),
            value: normalizedFenceContent(source, block),
            position: fencedBlockPosition(tokenStart, block, context),
          };
        },
      },
      {
        token: BlockKind.IndentedCodeBlock,
        build(tokenStart, context) {
          const tokens = context.structure.tokens;
          const offset = tokens.start(tokenStart);
          const contentLength = tokens.value<number>(tokenStart)!;
          const lines = context.locator
            .normalizeLineEndings(tokens.text(context.source, tokenStart))
            .split("\n")
            .map((line) => removeIndent(line, 4));
          while (lines.length && /^[ \t]*$/.test(lines[lines.length - 1])) {
            lines.pop();
          }
          return {
            type: "code",
            lang: null,
            meta: null,
            value: lines.join("\n"),
            position: context.locator.positionAt(offset, offset + contentLength),
          };
        },
      },
    ],
    starts: [
      {
        codes: [
          Character.VirtualBlockIndent,
        ],
        start(source, lines, start, _contentOffset, out) {
          let end = start + 1;
          while (end < lines.length && lineIndentOffset(source, lines, end) < 0) {
            end++;
          }
          // The block consumes trailing blank lines, but its code value and position do not include them.
          let contentEnd = end;
          while (contentEnd > start && isBlank(source, lines, contentEnd - 1)) {
            contentEnd--;
          }
          const contentLength = lines.end(contentEnd - 1) - lines.start(start);
          appendLogicalToken(
            out,
            BlockKind.IndentedCodeBlock,
            source,
            lines,
            start,
            end,
            contentLength,
          );
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
          appendLogicalToken(
            out,
            BlockKind.FencedCodeBlock,
            source,
            lines,
            start,
            end,
            fencedBlock(source, lines, start, end, fence, closed),
          );
          return end;
        },
      },
    ],
  },
  inline: {
    scan: [
      {
        marker: Character.GraveAccent,
        scan(source, start, tokens) {
          if (source.charCodeAt(start - 1) === Character.GraveAccent) {
            return start + 1;
          }
          const openEnd = inlineMarkerRunEnd(source, start);
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
          return start + 1;
        },
      },
    ],
    build: [
      {
        kind: "leaf",
        token: InlineKind.CodeSpan,
        build: (tokenIndex, sourceSpan, context) => {
          const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
          const markerLength = inlineTokenData(context.tokens, tokenIndex);
          let value = context.locator.normalizeLineEndings(
            text.slice(markerLength, -markerLength),
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
