import type { Paragraph } from "mdast";
import { closesFence, type Fence } from "../../../block/fence.ts";
import { type BlockLines, lineIndentOffset, skipLineWhitespace } from "../../../block/lines.ts";
import { appendLogicalToken, type BlockTokenStream } from "../../../block/tokens.ts";
import { BlockKind } from "../../../constants/block.ts";
import { Character } from "../../../constants/character.ts";
import { type BlockNodeBuilder, buildBlockChildren } from "../../../fragment/block.ts";
import { buildInlineFragment } from "../../../fragment/inline.ts";
import { attributesEnd, parseAttributes } from "../attributes/shared.ts";
import { codeFenceAt } from "../code.ts";
import { buildYamlBlock } from "../frontmatter.ts";
import { componentNameEnd, normalizeComponentName } from "./shared.ts";
import type { BlockFeature, BlockStart } from "../../../block/profile.ts";
import type { BlockScanContext } from "../../../block/scanner.ts";

interface BlockOpening {
  attributesEnd?: number;
  attributesStart?: number;
  fenceSize: number;
  labelEnd?: number;
  labelStart?: number;
  nameEnd: number;
}

interface BlockClosing {
  index: number;
  offset: number;
}

interface SlotOpening {
  attributesEnd?: number;
  attributesStart?: number;
  nameEnd: number;
  offset: number;
}

function closingBracket(source: string, start: number, limit: number): number | undefined {
  let depth = 0;
  for (let offset = start + 1; offset < limit; offset++) {
    if (source[offset] === "\\" && offset + 1 < limit) {
      offset++;
    }
    else if (source[offset] === "[") {
      depth++;
    }
    else if (source[offset] === "]") {
      if (depth === 0) {
        return offset;
      }
      depth--;
    }
  }
}

function lineValue(source: string, lines: BlockLines, index: number): string | undefined {
  const offset = lineIndentOffset(source, lines, index);
  return offset < 0 ? void 0 : source.slice(offset, lines.end(index));
}

function yamlClosingMarker(value: string | undefined): string | undefined {
  switch (value) {
    case "---":
      return "---";
    case "```yaml [props]":
    case "```yml [props]":
      return "```";
    case "~~~yaml [props]":
    case "~~~yml [props]":
      return "~~~";
  }
}

function yamlPropsEnd(
  source: string,
  lines: BlockLines,
  start: number,
  end: number,
): number | undefined {
  const marker = yamlClosingMarker(lineValue(source, lines, start));
  if (!marker) {
    return;
  }
  for (let index = start + 1; index < end; index++) {
    if (lineValue(source, lines, index) === marker) {
      return index + 1;
    }
  }
}

function slotOpeningAt(
  source: string,
  lines: BlockLines,
  index: number,
  contentOffset: number,
): SlotOpening | undefined {
  if (
    source[contentOffset] !== "#" ||
    source[contentOffset + 1] === "#" || source[contentOffset + 1] === " " ||
    source[contentOffset + 1] === "\t"
  ) {
    return;
  }
  const nameEnd = componentNameEnd(source, contentOffset + 1, true);
  const lineEnd = lines.end(index);
  if (nameEnd === void 0 || nameEnd > lineEnd) {
    return;
  }
  let offset = skipLineWhitespace(source, nameEnd, lineEnd);
  let attributesStart: number | undefined;
  let parsedAttributesEnd: number | undefined;
  if (source[offset] === "{") {
    parsedAttributesEnd = attributesEnd(source, offset, lineEnd);
    if (parsedAttributesEnd === void 0) {
      return;
    }
    attributesStart = offset;
    offset = parsedAttributesEnd;
  }
  if (skipLineWhitespace(source, offset, lineEnd) !== lineEnd) {
    return;
  }
  return {
    attributesEnd: parsedAttributesEnd,
    attributesStart,
    nameEnd,
    offset: contentOffset,
  };
}

function blockOpeningAt(
  source: string,
  lines: BlockLines,
  index: number,
  contentOffset: number,
  shorthand: boolean,
): BlockOpening | undefined {
  let offset = contentOffset;
  while (source[offset] === ":") {
    offset++;
  }
  const fenceSize = offset - contentOffset;
  if (shorthand ? fenceSize !== 1 : fenceSize < 2) {
    return;
  }
  const lineEnd = lines.end(index);
  if (!shorthand) {
    offset = skipLineWhitespace(source, offset, lineEnd);
  }
  const nameStart = offset;
  const nameEnd = componentNameEnd(source, nameStart, true);
  if (nameEnd === void 0 || nameEnd > lineEnd) {
    return;
  }
  offset = skipLineWhitespace(source, nameEnd, lineEnd);
  let labelStart: number | undefined;
  let labelEnd: number | undefined;
  if (source[offset] === "[") {
    const close = closingBracket(source, offset, lineEnd);
    if (close === void 0) {
      return;
    }
    labelStart = offset;
    labelEnd = close + 1;
    offset = skipLineWhitespace(source, labelEnd, lineEnd);
  }
  let attributesStart: number | undefined;
  let parsedAttributesEnd: number | undefined;
  if (source[offset] === "{") {
    parsedAttributesEnd = attributesEnd(source, offset, lineEnd);
    if (parsedAttributesEnd === void 0) {
      return;
    }
    attributesStart = offset;
    offset = parsedAttributesEnd;
  }
  if (skipLineWhitespace(source, offset, lineEnd) !== lineEnd) {
    return;
  }
  return {
    attributesEnd: parsedAttributesEnd,
    attributesStart,
    fenceSize,
    labelEnd,
    labelStart,
    nameEnd,
  };
}

function fenceAt(
  source: string,
  lines: BlockLines,
  index: number,
  size: number,
  contentOffset: number,
): number | undefined {
  let offset = contentOffset;
  while (source[offset] === ":") {
    offset++;
  }
  const lineEnd = lines.end(index);
  if (offset - contentOffset !== size || skipLineWhitespace(source, offset, lineEnd) !== lineEnd) {
    return;
  }
  return contentOffset;
}

function blockClose(
  source: string,
  lines: BlockLines,
  start: number,
  opening: BlockOpening,
): BlockClosing | undefined {
  let codeFence: Fence | undefined;
  let depth = 0;
  for (let index = start + 1; index < lines.length; index++) {
    if (codeFence) {
      if (closesFence(source, lines, index, codeFence)) {
        codeFence = void 0;
      }
      continue;
    }
    const contentOffset = lineIndentOffset(source, lines, index);
    if (contentOffset < 0) {
      continue;
    }
    codeFence = codeFenceAt(source, lines, index, contentOffset);
    if (codeFence) {
      continue;
    }
    const closeOffset = fenceAt(source, lines, index, opening.fenceSize, contentOffset);
    if (closeOffset !== void 0) {
      if (depth === 0) {
        return { index, offset: closeOffset };
      }
      depth--;
      continue;
    }
    if (
      blockOpeningAt(source, lines, index, contentOffset, false)?.fenceSize === opening.fenceSize
    ) {
      depth++;
    }
  }
}

function nextSlot(
  source: string,
  lines: BlockLines,
  start: number,
  end: number,
): { index: number; opening: SlotOpening } | undefined {
  let codeFence: Fence | undefined;
  for (let index = start; index < end; index++) {
    if (codeFence) {
      if (closesFence(source, lines, index, codeFence)) {
        codeFence = void 0;
      }
      continue;
    }
    const contentOffset = lineIndentOffset(source, lines, index);
    if (contentOffset < 0) {
      continue;
    }
    codeFence = codeFenceAt(source, lines, index, contentOffset);
    if (codeFence) {
      continue;
    }
    const slot = slotOpeningAt(source, lines, index, contentOffset);
    if (slot) {
      return { index, opening: slot };
    }
    const nested = blockOpeningAt(source, lines, index, contentOffset, false);
    if (nested) {
      index = blockClose(source, lines, index, nested)?.index ?? index;
    }
  }
}

function emitComponentBody(
  source: string,
  lines: BlockLines,
  start: number,
  end: number,
  closingOffset: number,
  out: BlockTokenStream,
  context: BlockScanContext,
): void {
  let cursor = start;
  const yamlEnd = cursor < end ? yamlPropsEnd(source, lines, cursor, end) : void 0;
  if (yamlEnd !== void 0) {
    appendLogicalToken(out, BlockKind.BlockComponentYamlProps, source, lines, cursor, yamlEnd);
    cursor = yamlEnd;
  }
  let slot = nextSlot(source, lines, cursor, end);
  if (!slot) {
    context.scanLines(source, lines.slice(cursor, end), out);
    return;
  }
  if (slot.index > cursor) {
    context.scanLines(source, lines.slice(cursor, slot.index), out);
  }
  while (slot) {
    const following = nextSlot(source, lines, slot.index + 1, end);
    const next = following?.index ?? end;
    const opening = slot.opening;
    out.push(BlockKind.BlockComponentSlotOpen, opening.offset, opening.nameEnd);
    if (opening.attributesStart !== void 0 && opening.attributesEnd !== void 0) {
      out.push(BlockKind.BlockComponentAttributes, opening.attributesStart, opening.attributesEnd);
    }
    context.scanLines(source, lines.slice(slot.index + 1, next), out);
    const slotEnd = following ? following.opening.offset : closingOffset;
    out.push(BlockKind.BlockComponentSlotClose, slotEnd, slotEnd);
    slot = following;
  }
}

function emitOpening(
  contentOffset: number,
  opening: BlockOpening,
  out: BlockTokenStream,
): void {
  out.push(BlockKind.BlockComponentOpen, contentOffset, opening.nameEnd);
  if (opening.labelStart !== void 0 && opening.labelEnd !== void 0) {
    out.push(BlockKind.BlockComponentLabelOpen, opening.labelStart, opening.labelStart + 1);
    if (opening.labelEnd > opening.labelStart + 2) {
      out.push(BlockKind.InlineChunk, opening.labelStart + 1, opening.labelEnd - 1);
    }
    out.push(BlockKind.BlockComponentLabelClose, opening.labelEnd - 1, opening.labelEnd);
  }
  if (opening.attributesStart !== void 0 && opening.attributesEnd !== void 0) {
    out.push(BlockKind.BlockComponentAttributes, opening.attributesStart, opening.attributesEnd);
  }
}

const buildBlockLabel: BlockNodeBuilder<Paragraph> = (tokenStart, context) => {
  const tokens = context.structure.tokens;
  const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
  const start = context.locator.locationAt(tokens.start(tokenStart));
  const children = buildInlineFragment(tokenStart, false, context).children;
  return {
    type: "paragraph",
    children,
    position: {
      start,
      end: context.locator.locationAt(tokens.end(close)),
    },
  };
};

function createBlockStart(shorthand: boolean): BlockStart {
  return (source, lines, start, contentOffset, out, context) => {
    const opening = blockOpeningAt(source, lines, start, contentOffset, shorthand);
    if (!opening) {
      return;
    }
    if (shorthand) {
      emitOpening(contentOffset, opening, out);
      const lineEnd = lines.end(start);
      out.push(BlockKind.BlockComponentClose, lineEnd, lineEnd);
      return start + 1;
    }
    const closing = blockClose(source, lines, start, opening);
    if (!closing) {
      context.retainLookahead(lines.next(lines.length - 1));
      return;
    }
    emitOpening(contentOffset, opening, out);
    emitComponentBody(
      source,
      lines,
      start + 1,
      closing.index,
      closing.offset,
      out,
      context,
    );
    out.push(BlockKind.BlockComponentClose, closing.offset, lines.end(closing.index));
    return closing.index + 1;
  };
}

export const blockBuilds: BlockFeature["builds"] = [
  {
    // The YAML props fence becomes a child yaml node, matching frontmatter's shape;
    // interpreting the mapping itself is the consumer's job.
    token: BlockKind.BlockComponentYamlProps,
    build: buildYamlBlock,
  },
  {
    token: BlockKind.BlockComponentOpen,
    build(tokenStart, context) {
      const tokens = context.structure.tokens;
      const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
      // Component header fields are emitted in this fixed order before any body syntax.
      let openingToken = tokenStart + 1;
      const label = tokens.kind(openingToken) === BlockKind.BlockComponentLabelOpen
        ? openingToken
        : void 0;
      if (label !== void 0) {
        openingToken += tokens.nodeLength(label);
      }
      const attributesToken = tokens.kind(openingToken) === BlockKind.BlockComponentAttributes
        ? openingToken++
        : void 0;
      const parsed = attributesToken !== void 0
        ? parseAttributes(context.source, tokens.start(attributesToken))
        : void 0;
      const start = context.locator.locationAt(tokens.start(tokenStart));
      let children = buildBlockChildren(tokenStart, context);
      if (label) {
        children = [buildBlockLabel(label, context), ...children];
      }
      const opening = tokens.text(context.source, tokenStart);
      return {
        type: "blockComponent",
        name: normalizeComponentName(opening.slice(opening.lastIndexOf(":") + 1).trim()),
        attributes: parsed ?? {},
        position: {
          start,
          end: context.locator.locationAt(tokens.end(close)),
        },
        children,
      };
    },
  },
  {
    token: BlockKind.BlockComponentSlotOpen,
    build(tokenStart, context) {
      const tokens = context.structure.tokens;
      const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
      const attributesToken = tokens.kind(tokenStart + 1) === BlockKind.BlockComponentAttributes
        ? tokenStart + 1
        : void 0;
      const parsed = attributesToken !== void 0
        ? parseAttributes(context.source, tokens.start(attributesToken))
        : void 0;
      const start = context.locator.locationAt(tokens.start(tokenStart));
      const children = buildBlockChildren(tokenStart, context);
      return {
        type: "blockComponent",
        name: "template",
        attributes: {
          ...parsed,
          name: normalizeComponentName(tokens.text(context.source, tokenStart).slice(1).trim()),
        },
        children,
        position: {
          start,
          end: context.locator.locationAt(tokens.end(close)),
        },
      };
    },
  },
];

export const blockStarts: BlockFeature["starts"] = [
  {
    codes: [
      Character.Colon,
    ],
    interrupt(source, lines, index, contentOffset) {
      return (
        blockOpeningAt(source, lines, index, contentOffset, false) !== void 0 ||
        blockOpeningAt(source, lines, index, contentOffset, true) !== void 0
      );
    },
    start: createBlockStart(false),
  },
  {
    codes: [
      Character.Colon,
    ],
    start: createBlockStart(true),
  },
];
