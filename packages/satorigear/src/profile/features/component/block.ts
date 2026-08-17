import type { Paragraph, RootContent } from "mdast";
import { closesFence, type Fence } from "../../../block/fence.ts";
import { type BlockLine, lineIndent } from "../../../block/lines.ts";
import { appendLogicalToken } from "../../../block/tokens.ts";
import { BlockKind, BlockRule } from "../../../constants/block.ts";
import { Character } from "../../../constants/character.ts";
import {
  type BlockNodeBuilder,
  buildBlockChildren,
} from "../../../fragment/block.ts";
import { buildInlineFragment } from "../../../fragment/inline.ts";
import {
  attributesEnd,
  closingBracket,
  componentNameEnd,
  normalizeComponentName,
  parseAttributes,
} from "../attributes/syntax.ts";
import { codeFenceAt } from "../code.ts";
import { buildFrontmatter } from "../frontmatter.ts";
import type { BlockFeature, BlockStart } from "../../../block/profile.ts";
import type { SpannedNode } from "../../../fragment/node.ts";

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

interface YamlPropsBlock {
  close: number;
  open: number;
}

function skipSpaces(source: string, offset: number, end: number): number {
  while (offset < end && (source[offset] === " " || source[offset] === "\t")) {
    offset++;
  }
  return offset;
}

function contentOffsetOf(source: string, line: BlockLine): number | undefined {
  return lineIndent(source, line)?.offset;
}

function lineValue(source: string, line: BlockLine): string | undefined {
  const offset = contentOffsetOf(source, line);
  return offset === void 0 ? void 0 : source.slice(offset, line.end);
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

function yamlPropsAt(
  source: string,
  lines: readonly BlockLine[],
  start: number,
  end: number,
): YamlPropsBlock | undefined {
  const marker = yamlClosingMarker(lineValue(source, lines[start]));
  if (!marker) {
    return;
  }
  for (let index = start + 1; index < end; index++) {
    if (lineValue(source, lines[index]) === marker) {
      return { open: start, close: index };
    }
  }
}

function slotOpeningAt(
  source: string,
  line: BlockLine,
): SlotOpening | undefined {
  const contentOffset = contentOffsetOf(source, line);
  if (
    contentOffset === void 0 || source[contentOffset] !== "#" ||
    source[contentOffset + 1] === "#" || source[contentOffset + 1] === " " ||
    source[contentOffset + 1] === "\t"
  ) {
    return;
  }
  const nameEnd = componentNameEnd(source, contentOffset + 1, true);
  if (nameEnd === void 0 || nameEnd > line.end) {
    return;
  }
  let offset = skipSpaces(source, nameEnd, line.end);
  let attributesStart: number | undefined;
  let parsedAttributesEnd: number | undefined;
  if (source[offset] === "{") {
    parsedAttributesEnd = attributesEnd(source, offset, line.end);
    if (parsedAttributesEnd === void 0) {
      return;
    }
    attributesStart = offset;
    offset = parsedAttributesEnd;
  }
  if (skipSpaces(source, offset, line.end) !== line.end) {
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
  line: BlockLine,
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
  if (!shorthand) {
    offset = skipSpaces(source, offset, line.end);
  }
  const nameStart = offset;
  const nameEnd = componentNameEnd(source, nameStart, true);
  if (nameEnd === void 0 || nameEnd > line.end) {
    return;
  }
  offset = skipSpaces(source, nameEnd, line.end);
  let labelStart: number | undefined;
  let labelEnd: number | undefined;
  if (source[offset] === "[") {
    const close = closingBracket(source, offset);
    if (close === void 0 || close >= line.end) {
      return;
    }
    labelStart = offset;
    labelEnd = close + 1;
    offset = skipSpaces(source, labelEnd, line.end);
  }
  let attributesStart: number | undefined;
  let parsedAttributesEnd: number | undefined;
  if (source[offset] === "{") {
    parsedAttributesEnd = attributesEnd(source, offset, line.end);
    if (parsedAttributesEnd === void 0) {
      return;
    }
    attributesStart = offset;
    offset = parsedAttributesEnd;
  }
  if (skipSpaces(source, offset, line.end) !== line.end) {
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

function nestedComponentEnd(
  source: string,
  lines: readonly BlockLine[],
  index: number,
): number | undefined {
  const offset = contentOffsetOf(source, lines[index]);
  if (offset === void 0) {
    return;
  }
  const opening = blockOpeningAt(source, lines[index], offset, false);
  return opening ? blockClose(source, lines, index, opening)?.index : void 0;
}

function fenceAt(source: string, line: BlockLine, size: number): number | undefined {
  const indent = lineIndent(source, line);
  if (!indent) {
    return;
  }
  let offset = indent.offset;
  while (source[offset] === ":") {
    offset++;
  }
  if (offset - indent.offset !== size || skipSpaces(source, offset, line.end) !== line.end) {
    return;
  }
  return indent.offset;
}

function blockClose(
  source: string,
  lines: readonly BlockLine[],
  start: number,
  opening: BlockOpening,
): BlockClosing | undefined {
  let codeFence: Fence | undefined;
  let depth = 0;
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index];
    if (codeFence) {
      if (closesFence(source, line, codeFence)) {
        codeFence = void 0;
      }
      continue;
    }
    codeFence = codeFenceAt(source, line);
    if (codeFence) {
      continue;
    }
    const closeOffset = fenceAt(source, line, opening.fenceSize);
    if (closeOffset !== void 0) {
      if (depth === 0) {
        return { index, offset: closeOffset };
      }
      depth--;
      continue;
    }
    const indent = lineIndent(source, line);
    if (indent && blockOpeningAt(source, line, indent.offset, false)?.fenceSize === opening.fenceSize) {
      depth++;
    }
  }
}

function nextSlot(
  source: string,
  lines: readonly BlockLine[],
  start: number,
  end: number,
): { index: number; opening: SlotOpening } | undefined {
  let codeFence: Fence | undefined;
  for (let index = start; index < end; index++) {
    const line = lines[index];
    if (codeFence) {
      if (closesFence(source, line, codeFence)) {
        codeFence = void 0;
      }
      continue;
    }
    codeFence = codeFenceAt(source, line);
    if (codeFence) {
      continue;
    }
    const slot = slotOpeningAt(source, line);
    if (slot) {
      return { index, opening: slot };
    }
    const nestedEnd = nestedComponentEnd(source, lines, index);
    if (nestedEnd !== void 0) {
      index = nestedEnd;
    }
  }
}

function emitSlotOpening(
  source: string,
  opening: SlotOpening,
  out: Parameters<BlockStart>[3],
): void {
  out.push(BlockKind.BlockComponentSlotOpen, opening.offset, opening.nameEnd);
  if (opening.attributesStart !== void 0 && opening.attributesEnd !== void 0) {
    out.push(BlockKind.BlockComponentAttributes, opening.attributesStart, opening.attributesEnd);
  }
}

function emitComponentBody(
  source: string,
  lines: readonly BlockLine[],
  start: number,
  end: number,
  closingOffset: number,
  out: Parameters<BlockStart>[3],
  context: Parameters<BlockStart>[5],
): void {
  let cursor = start;
  const yaml = cursor < end ? yamlPropsAt(source, lines, cursor, end) : void 0;
  if (yaml) {
    appendLogicalToken(out, BlockKind.BlockComponentYamlProps, source, lines, yaml.open, yaml.close + 1);
    cursor = yaml.close + 1;
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
    emitSlotOpening(source, slot.opening, out);
    context.scanLines(source, lines.slice(slot.index + 1, next), out);
    const slotEnd = following ? following.opening.offset : closingOffset;
    out.push(BlockKind.BlockComponentSlotClose, slotEnd, slotEnd);
    slot = following;
  }
}

function emitOpening(
  source: string,
  contentOffset: number,
  opening: BlockOpening,
  out: Parameters<BlockStart>[3],
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

const buildBlockLabel: BlockNodeBuilder<Paragraph> = (tokenStart, context, inline) => {
  const tokens = context.structure.tokens;
  const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
  return {
    type: "paragraph",
    children: inline!.children,
    position: {
      start: tokens.start(tokenStart),
      end: tokens.end(close),
    },
  };
};

function createBlockStart(shorthand: boolean): BlockStart {
  return (source, lines, start, out, contentOffset, context) => {
    const opening = blockOpeningAt(source, lines[start], contentOffset, shorthand);
    if (!opening) {
      return;
    }
    if (shorthand) {
      emitOpening(source, contentOffset, opening, out);
      out.push(BlockKind.BlockComponentClose, lines[start].end, lines[start].end);
      return start + 1;
    }
    const closing = blockClose(source, lines, start, opening);
    if (!closing) {
      return;
    }
    emitOpening(source, contentOffset, opening, out);
    emitComponentBody(
      source,
      lines,
      start + 1,
      closing.index,
      closing.offset,
      out,
      context,
    );
    out.push(BlockKind.BlockComponentClose, closing.offset, lines[closing.index].end);
    return closing.index + 1;
  };
}

export const blockRules: BlockFeature["rules"] = [
  {
    // The YAML props fence becomes a child yaml node, matching frontmatter's shape;
    // interpreting the mapping itself is the consumer's job.
    rule: BlockRule.BlockComponentYamlProps,
    syntax: {
      kind: "leaf",
      token: BlockKind.BlockComponentYamlProps,
    },
    build: buildFrontmatter,
  },
  {
    rule: BlockRule.BlockComponentLabel,
    syntax: {
      kind: "frame",
      open: BlockKind.BlockComponentLabelOpen,
      close: BlockKind.BlockComponentLabelClose,
    },
    inlineContent: true,
    build: buildBlockLabel,
  },
  {
    rule: BlockRule.BlockComponent,
    syntax: {
      kind: "block",
      open: BlockKind.BlockComponentOpen,
      close: BlockKind.BlockComponentClose,
    },
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
      const children: SpannedNode<RootContent>[] = [];
      if (label) {
        children.push(buildBlockLabel(label, context, buildInlineFragment(label, context)));
      }
      children.push(...buildBlockChildren(tokenStart, context));
      const opening = tokens.text(context.source, tokenStart);
      return {
        type: "blockComponent",
        name: normalizeComponentName(opening.slice(opening.lastIndexOf(":") + 1).trim()),
        attributes: parsed?.attributes ?? {},
        position: {
          start: tokens.start(tokenStart),
          end: tokens.end(close),
        },
        children,
      };
    },
  },
  {
    rule: BlockRule.BlockComponentSlot,
    syntax: {
      kind: "block",
      open: BlockKind.BlockComponentSlotOpen,
      close: BlockKind.BlockComponentSlotClose,
    },
    build(tokenStart, context) {
      const tokens = context.structure.tokens;
      const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
      const attributesToken = tokens.kind(tokenStart + 1) === BlockKind.BlockComponentAttributes
        ? tokenStart + 1
        : void 0;
      const parsed = attributesToken !== void 0
        ? parseAttributes(context.source, tokens.start(attributesToken))
        : void 0;
      const children = buildBlockChildren(tokenStart, context);
      return {
        type: "blockComponent",
        name: "template",
        attributes: {
          ...parsed?.attributes,
          name: normalizeComponentName(tokens.text(context.source, tokenStart).slice(1).trim()),
        },
        children,
        position: {
          start: tokens.start(tokenStart),
          end: tokens.end(close),
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
    interrupt(source, line, contentOffset) {
      return (
        blockOpeningAt(source, line, contentOffset, false) !== void 0 ||
        blockOpeningAt(source, line, contentOffset, true) !== void 0
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
