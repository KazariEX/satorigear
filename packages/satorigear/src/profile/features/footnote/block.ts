import type { FootnoteDefinition } from "mdast";
import { type BlockLines, IndentedLine, isBlank } from "../../../block/lines.ts";
import { BlockKind } from "../../../constants/block.ts";
import { Character } from "../../../constants/character.ts";
import { blockEnd, buildBlockChildren } from "../../../fragment/block.ts";
import { semanticText } from "../../utils.ts";
import { type FootnoteLabel, footnoteLabelAt } from "./shared.ts";
import type { BlockFeature } from "../../../block/profile.ts";

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
  if (!label || source.charCodeAt(label.end) !== Character.Colon) {
    return;
  }
  const markerEnd = label.end + 1;
  let contentOffset = markerEnd;
  while (contentOffset < lineEnd) {
    const code = source.charCodeAt(contentOffset);
    if (code !== Character.Space && code !== Character.CharacterTabulation) {
      break;
    }
    contentOffset++;
  }
  return {
    ...label,
    contentOffset,
    markerEnd,
  };
}

export const blockBuilds: BlockFeature["builds"] = [
  {
    token: BlockKind.FootnoteDefinitionOpen,
    build(tokenStart, context) {
      const tokens = context.structure.tokens;
      // This rule only builds openers emitted with their parsed definition fields.
      const fields = tokens.value<FootnoteDefinitionFields>(tokenStart)!;
      const start = context.locator.locationAt(tokens.start(tokenStart));
      const children = buildBlockChildren<FootnoteDefinition["children"][number]>(tokenStart, context);
      return {
        type: "footnoteDefinition",
        identifier: fields.normalizedLabel,
        label: semanticText(fields.label),
        children,
        position: {
          start,
          end: context.locator.locationAt(blockEnd(tokenStart, context)),
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
      const definitionLines = context.createLineView(lines, start, match.contentOffset, 0);
      let index = start + 1;
      let lazyParagraph = context.endsWithParagraphLeaf(source, definitionLines, 0);
      while (index < lines.length) {
        const line = definitionLines.pushAfterColumns(source, lines, index, 4);
        if (line === IndentedLine.Blank) {
          definitionLines.pushFrom(lines, index);
          lazyParagraph = false;
          index++;
          continue;
        }
        if (line === IndentedLine.Appended) {
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
