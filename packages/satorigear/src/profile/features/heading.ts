import type { Heading } from "mdast";
import { type BlockLine, lineIndent, named, structural } from "../../block/primitives.ts";
import {
  blockEnd,
  blockToken,
  directBlockToken,
  firstChildStart,
  inlineChildren,
  tokenEnd,
  tokenStart,
  withSpan,
} from "../../mdast.ts";
import type { SyntaxFeature } from "../types.ts";

function atxAt(source: string, line: BlockLine): {
  contentEnd: number;
  contentOffset: number;
  marker: string;
  markerOffset: number;
} | null {
  const indent = lineIndent(source, line);
  if (!indent || source[indent.offset] !== "#") {
    return null;
  }
  const match = /^(#{1,6})(?:[ \t]+|$)/.exec(source.slice(indent.offset, line.end));
  if (!match) {
    return null;
  }
  const contentOffset = indent.offset + match[0].length;
  let contentEnd = line.end;
  while (contentEnd > contentOffset && (source[contentEnd - 1] === " " || source[contentEnd - 1] === "\t")) {
    contentEnd--;
  }
  let closer = contentEnd;
  while (closer > contentOffset && source[closer - 1] === "#") {
    closer--;
  }
  if (closer < contentEnd && (closer === contentOffset || source[closer - 1] === " " || source[closer - 1] === "\t")) {
    contentEnd = closer;
    while (contentEnd > contentOffset && (source[contentEnd - 1] === " " || source[contentEnd - 1] === "\t")) {
      contentEnd--;
    }
  }
  return { markerOffset: indent.offset, marker: match[1], contentOffset, contentEnd };
}

export function setextMarkerAt(source: string, line: BlockLine): "=" | "-" | null {
  const indent = lineIndent(source, line);
  if (!indent) {
    return null;
  }
  const marker = source[indent.offset];
  const match = marker === "=" || marker === "-"
    ? /^(=+|-+)[ \t]*$/.exec(source.slice(indent.offset, line.end))
    : null;
  return match ? match[1][0] as "=" | "-" : null;
}

export const feature: SyntaxFeature = {
  blockRules: [
    {
      rule: "AtxHeading",
      inlineContent: true,
      project(nodeId, offset, tokenBase, context) {
        const marker = blockToken(nodeId, tokenBase, "AtxHeadingOpen", context);
        return withSpan<Heading>({
          type: "heading",
          depth: tokenEnd(marker) - tokenStart(marker) as Heading["depth"],
          children: inlineChildren(nodeId, context, true),
        }, tokenStart(marker), blockEnd(nodeId, offset, context));
      },
    },
    {
      rule: "SetextHeading",
      inlineContent: true,
      project(nodeId, offset, tokenBase, context) {
        const levelOne = directBlockToken(nodeId, tokenBase, "SetextHeading1Open", context);
        if (!levelOne) {
          blockToken(nodeId, tokenBase, "SetextHeading2Open", context);
        }
        const result: Heading = {
          type: "heading",
          depth: levelOne ? 1 : 2,
          children: inlineChildren(nodeId, context),
        };
        return withSpan(
          result,
          firstChildStart(result),
          tokenStart(blockToken(nodeId, tokenBase, "HeadingClose", context)),
        );
      },
    },
  ],
  blockStarts: [
    {
      codes: [35],
      interrupt(source, line) {
        return !!atxAt(source, line);
      },
      start(source, lines, start, out) {
        const line = lines[start];
        const atx = atxAt(source, line);
        if (!atx) {
          return void 0;
        }
        out.push(structural("AtxHeadingOpen", atx.markerOffset, atx.marker));
        if (atx.contentEnd > atx.contentOffset) {
          out.push(named("InlineChunk", source.slice(atx.contentOffset, atx.contentEnd), atx.contentOffset));
        }
        out.push(structural("HeadingClose", line.end));
        return start + 1;
      },
    },
  ],
};
