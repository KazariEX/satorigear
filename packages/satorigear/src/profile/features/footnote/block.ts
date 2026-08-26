import { BlockLines, contentAfterColumns, isBlank } from "../../../block/lines.ts";
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
}

function definitionAt(
  source: string,
  lines: BlockLines,
  index: number,
  markerStart: number,
): FootnoteDefinitionMatch | undefined {
  const lineEnd = lines.end(index);
  const label = footnoteLabelAt(source, markerStart, lineEnd);
  if (!label || source[label.end] !== ":") {
    return;
  }
  const markerEnd = label.end + 1;
  let contentOffset = markerEnd;
  while (contentOffset < lineEnd && (source[contentOffset] === " " || source[contentOffset] === "\t")) {
    contentOffset++;
  }
  return {
    ...label,
    contentOffset,
    markerEnd,
  };
}

function definitionFields(tokens: BlockTokenStream, token: number): FootnoteDefinitionFields {
  const fields = tokens.value<FootnoteDefinitionFields>(token);
  if (tokens.kind(token) !== BlockKind.FootnoteDefinitionOpen || !fields) {
    throw new Error("Expected FootnoteDefinitionOpen token to contain parsed fields");
  }
  return fields;
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
    unwrapLazyContinuation(source, lines, index, contentOffset, target) {
      const match = definitionAt(source, lines, index, contentOffset);
      if (!match) {
        return false;
      }
      target.resetFrom(lines, index, match.contentOffset, 0);
      return true;
    },
    interrupt(source, lines, index, contentOffset) {
      return definitionAt(source, lines, index, contentOffset) !== void 0;
    },
    start(source, lines, start, contentOffset, out, context) {
      const match = definitionAt(source, lines, start, contentOffset);
      if (!match) {
        return;
      }
      const definitionLines = new BlockLines();
      definitionLines.pushFrom(lines, start, match.contentOffset, 0);
      let index = start + 1;
      let lazyParagraph = context.endsWithParagraphLeaf(source, definitionLines, 0);
      while (index < lines.length) {
        if (isBlank(source, lines, index)) {
          definitionLines.pushFrom(lines, index);
          lazyParagraph = false;
          index++;
          continue;
        }
        const content = contentAfterColumns(source, lines, index, 4);
        if (content) {
          definitionLines.pushFrom(lines, index, content.offset, content.prefixColumns);
          lazyParagraph = context.endsWithParagraphLeaf(
            source,
            definitionLines,
            definitionLines.length - 1,
          );
          index++;
          continue;
        }
        if (!lazyParagraph || (!lines.lazy(index) && context.startsInterruptingBlock(source, lines, index))) {
          break;
        }
        definitionLines.pushLazy(lines, index);
        index++;
      }
      while (definitionLines.length > 0 && isBlank(source, definitionLines, definitionLines.length - 1)) {
        definitionLines.pop();
      }
      out.push(
        BlockKind.FootnoteDefinitionOpen,
        contentOffset,
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
      const end = definitionLines.length > 0
        ? definitionLines.next(definitionLines.length - 1)
        : match.markerEnd;
      out.push(BlockKind.FootnoteDefinitionClose, end, end);
      return index;
    },
  },
];
