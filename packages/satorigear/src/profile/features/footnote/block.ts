import { type BlockLine, contentAfterColumns, isBlank, lineIndentOffset } from "../../../block/lines.ts";
import { BlockKind, BlockRule } from "../../../constants/block.ts";
import { Character } from "../../../constants/character.ts";
import { blockEnd, buildBlockChildren } from "../../../fragment/block.ts";
import { semanticText } from "../text.ts";
import { type FootnoteLabel, footnoteLabelAt } from "./shared.ts";
import type { BlockFeature } from "../../../block/profile.ts";
import type { BlockTokenStream } from "../../../block/tokens.ts";

interface FootnoteDefinitionFields {
  label: string;
  normalizedLabel: string;
}

interface FootnoteDefinitionMatch extends FootnoteLabel {
  contentOffset: number;
  markerEnd: number;
  markerStart: number;
}

function definitionAt(source: string, line: BlockLine): FootnoteDefinitionMatch | undefined {
  const markerStart = lineIndentOffset(source, line);
  if (markerStart < 0) {
    return;
  }
  const label = footnoteLabelAt(source, markerStart, line.end);
  if (!label || source[label.end] !== ":") {
    return;
  }
  const markerEnd = label.end + 1;
  let contentOffset = markerEnd;
  while (contentOffset < line.end && (source[contentOffset] === " " || source[contentOffset] === "\t")) {
    contentOffset++;
  }
  return {
    ...label,
    contentOffset,
    markerEnd,
    markerStart,
  };
}

function definitionFields(tokens: BlockTokenStream, token: number): FootnoteDefinitionFields {
  const fields = tokens.value<FootnoteDefinitionFields>(token);
  if (tokens.kind(token) !== BlockKind.FootnoteDefinitionOpen || !fields) {
    throw new Error("Expected FootnoteDefinitionOpen token to contain parsed fields");
  }
  return fields;
}

function firstContentLine(line: BlockLine, match: FootnoteDefinitionMatch): BlockLine {
  return { ...line, start: match.contentOffset, prefixColumns: 0 };
}

export const blockRules: BlockFeature["rules"] = [
  {
    rule: BlockRule.FootnoteDefinition,
    syntax: {
      kind: "block",
      open: BlockKind.FootnoteDefinitionOpen,
      close: BlockKind.FootnoteDefinitionClose,
    },
    build(tokenStart, context) {
      const fields = definitionFields(context.structure.tokens, tokenStart);
      return {
        type: "footnoteDefinition",
        identifier: fields.normalizedLabel.toLowerCase(),
        label: semanticText(fields.label),
        children: buildBlockChildren(tokenStart, context),
        position: {
          start: context.structure.tokens.start(tokenStart),
          end: blockEnd(tokenStart, context),
        },
      };
    },
  },
];

export const blockStarts: BlockFeature["starts"] = [
  {
    codes: [
      Character.LeftSquareBracket,
    ],
    unwrapLazyContinuation(source, line) {
      const match = definitionAt(source, line);
      return match ? firstContentLine(line, match) : void 0;
    },
    interrupt(source, line) {
      return definitionAt(source, line) !== void 0;
    },
    start(source, lines, start, out, contentOffset, context) {
      const match = definitionAt(source, lines[start]);
      if (!match) {
        return;
      }
      const definitionLines: BlockLine[] = [firstContentLine(lines[start], match)];
      let index = start + 1;
      let lazyParagraph = context.endsWithParagraphLeaf(source, definitionLines[0]);
      while (index < lines.length) {
        const line = lines[index];
        if (isBlank(source, line)) {
          definitionLines.push(line);
          lazyParagraph = false;
          index++;
          continue;
        }
        const content = contentAfterColumns(source, line, 4);
        if (content) {
          const contentLine = { ...line, start: content.offset, prefixColumns: content.prefixColumns };
          definitionLines.push(contentLine);
          lazyParagraph = context.endsWithParagraphLeaf(source, contentLine);
          index++;
          continue;
        }
        if (!lazyParagraph || (!line.lazy && context.startsInterruptingBlock(source, line))) {
          break;
        }
        definitionLines.push({ ...line, lazy: true });
        index++;
      }
      while (definitionLines.length > 0 && isBlank(source, definitionLines[definitionLines.length - 1])) {
        definitionLines.pop();
      }
      out.push(
        BlockKind.FootnoteDefinitionOpen,
        match.markerStart,
        match.markerEnd,
        {
          definitionKey: match.definitionKey,
          value: {
            label: match.label,
            normalizedLabel: match.normalizedLabel,
          },
        },
      );
      context.scanLines(source, definitionLines, out);
      const end = definitionLines.at(-1)?.next ?? match.markerEnd;
      out.push(BlockKind.FootnoteDefinitionClose, end, end);
      return index;
    },
  },
];
