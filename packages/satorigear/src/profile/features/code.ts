import {
  closesFence,
  type Fence,
  fenceAt,
  FenceContentMode,
  fencedBlock,
  type FencedBlock,
  fencedBlockContent,
  type FenceRule,
} from "../../block/fence.ts";
import {
  type BlockLine,
  indentOf,
  isBlank,
  normalizeLines,
  removeIndent,
} from "../../block/lines.ts";
import { appendLogicalToken } from "../../block/tokens.ts";
import { BlockKind, BlockRule } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { blockEnd } from "../../fragment/block.ts";
import { inlineMarkerRunEnd } from "../../inline/lexer.ts";
import { appendInlineToken, inlineTokenData, inlineTokenText } from "../../inline/tokens.ts";
import { semanticText } from "./text.ts";
import type { SyntaxFeature } from "../types.ts";

const codeFenceRule: FenceRule = {
  forbiddenInfoMarkers: [Character.GraveAccent],
  markers: [Character.GraveAccent, Character.Tilde],
  minimumLength: 3,
};

export function codeFenceAt(source: string, line: BlockLine): Fence | undefined {
  return fenceAt(source, line, codeFenceRule);
}

export const feature: SyntaxFeature = {
  block: {
    fallbacks: [
      (source, lines, start, out) => {
        if (indentOf(source, lines[start]).columns < 4) {
          return;
        }
        let end = start + 1;
        while (end < lines.length && (isBlank(source, lines[end]) || indentOf(source, lines[end]).columns >= 4)) {
          end++;
        }
        // The block consumes trailing blank lines, but its code value and position do not include them.
        let contentEnd = end;
        while (contentEnd > start && isBlank(source, lines[contentEnd - 1])) {
          contentEnd--;
        }
        const contentLength = lines[contentEnd - 1].end - lines[start].start;
        appendLogicalToken(
          out,
          BlockKind.IndentedCodeBlockToken,
          source,
          lines,
          start,
          end,
          contentLength,
        );
        return end;
      },
    ],
    rules: [
      {
        rule: BlockRule.FencedCode,
        syntax: {
          kind: "leaf",
          token: BlockKind.FencedCodeBlock,
        },
        build(tokenStart, context) {
          const offset = context.structure.tokens.start(tokenStart);
          const end = context.structure.tokens.end(tokenStart);
          const source = normalizeLines(
            context.structure.tokens.text(context.source, tokenStart),
          );
          const block = context.structure.tokens.value<FencedBlock>(tokenStart);
          if (!block) {
            throw new Error("FencedCodeBlock token has no fence metadata");
          }
          const rawInfo = semanticText(block.info);
          const langEnd = rawInfo.search(/[ \t]/);
          const lang = rawInfo ? langEnd < 0 ? rawInfo : rawInfo.slice(0, langEnd) : null;
          const metaStart = langEnd < 0 ? -1 : rawInfo.slice(langEnd).search(/[^ \t]/);
          return {
            type: "code",
            lang,
            meta: metaStart < 0 ? null : rawInfo.slice(langEnd + metaStart),
            value: fencedBlockContent(source, block, FenceContentMode.NormalizedSpaces),
            position: {
              start: offset + block.markerOffset,
              end: block.closed || end < context.structure.tokens.sourceLength
                ? blockEnd(tokenStart, context)
                : end,
            },
          };
        },
      },
      {
        rule: BlockRule.IndentedCodeBlock,
        syntax: {
          kind: "leaf",
          token: BlockKind.IndentedCodeBlockToken,
        },
        build(tokenStart, context) {
          const tokens = context.structure.tokens;
          const offset = tokens.start(tokenStart);
          const contentLength = tokens.value<number>(tokenStart)!;
          const lines = normalizeLines(tokens.text(context.source, tokenStart))
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
            position: { start: offset, end: offset + contentLength },
          };
        },
      },
    ],
    starts: [
      {
        codes: [
          Character.GraveAccent,
          Character.Tilde,
        ],
        interrupt(source, line) {
          return !!codeFenceAt(source, line);
        },
        start(source, lines, start, out) {
          const fence = codeFenceAt(source, lines[start]);
          if (!fence) {
            return;
          }
          let end = start + 1;
          while (end < lines.length && !closesFence(source, lines[end], fence)) {
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
            fencedBlock(source, lines[start], fence, closed),
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
          let end = -1;
          let offset = openEnd;
          while (offset < source.length) {
            if (source.charCodeAt(offset) !== Character.GraveAccent) {
              offset++;
              continue;
            }
            const closeEnd = inlineMarkerRunEnd(source, offset);
            if (closeEnd - offset === markerLength) {
              end = closeEnd;
              break;
            }
            offset = closeEnd;
          }
          if (end < 0) {
            return start + 1;
          }
          appendInlineToken(tokens, InlineKind.CodeSpan, start, end, markerLength);
          return end;
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
          let value = normalizeLines(text.slice(markerLength, -markerLength));
          if (/^[ \n]/.test(value) && /[ \n]$/.test(value) && /[^ \n]/.test(value)) {
            value = value.slice(1, -1);
          }
          return {
            type: "inlineCode",
            value: context.blockRule === BlockRule.TableCell
              ? value.replace(/\\\|/g, "|")
              : value,
            position: sourceSpan,
          };
        },
      },
    ],
  },
};
