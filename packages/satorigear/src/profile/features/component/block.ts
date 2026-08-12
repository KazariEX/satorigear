import { parse as parseYaml } from "yaml";
import type { Paragraph, RootContent } from "mdast";
import { closesFence, type Fence } from "../../../block/fence.ts";
import { type BlockLine, lineIndent } from "../../../block/lines.ts";
import { logicalToken, namedToken, structuralToken, tokenEnd, tokenStart } from "../../../block/tokens.ts";
import {
  type BlockNodeBuilder,
  blockToken,
  buildBlockChildren,
  directBlockToken,
} from "../../../fragment/block.ts";
import { buildInlineChildren } from "../../../fragment/inline.ts";
import {
  attributesEnd,
  closingBracket,
  componentNameEnd,
  normalizeComponentName,
  parseAttributes,
} from "../attributes/syntax.ts";
import { codeFenceAt } from "../code.ts";
import type { BlockFeature, BlockStart } from "../../../block/profile.ts";
import type { SpannedNode } from "../../../fragment/node.ts";
import type { Attributes } from "../attributes/types.ts";

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
  out.push(namedToken(
    "BlockComponentSlotOpen",
    source.slice(opening.offset, opening.nameEnd),
    opening.offset,
  ));
  if (opening.attributesStart !== void 0 && opening.attributesEnd !== void 0) {
    out.push(namedToken(
      "BlockComponentAttributes",
      source.slice(opening.attributesStart, opening.attributesEnd),
      opening.attributesStart,
    ));
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
    out.push(yaml.close > yaml.open + 1
      ? logicalToken("BlockComponentYamlProps", source, lines, yaml.open + 1, yaml.close)
      : structuralToken("BlockComponentYamlProps", lines[yaml.open].end));
    cursor = yaml.close + 1;
  }
  let slot = nextSlot(source, lines, cursor, end);
  if (!slot) {
    context.resolveLines(source, lines.slice(cursor, end), out);
    return;
  }
  if (slot.index > cursor) {
    context.resolveLines(source, lines.slice(cursor, slot.index), out);
  }
  while (slot) {
    const following = nextSlot(source, lines, slot.index + 1, end);
    const next = following?.index ?? end;
    emitSlotOpening(source, slot.opening, out);
    context.resolveLines(source, lines.slice(slot.index + 1, next), out);
    out.push(structuralToken(
      "BlockComponentSlotClose",
      following ? following.opening.offset : closingOffset,
    ));
    slot = following;
  }
}

function emitOpening(
  source: string,
  contentOffset: number,
  opening: BlockOpening,
  out: Parameters<BlockStart>[3],
): void {
  out.push(namedToken(
    "BlockComponentOpen",
    source.slice(contentOffset, opening.nameEnd),
    contentOffset,
  ));
  if (opening.labelStart !== void 0 && opening.labelEnd !== void 0) {
    out.push(namedToken("BlockComponentLabelOpen", "[", opening.labelStart));
    if (opening.labelEnd > opening.labelStart + 2) {
      out.push(namedToken(
        "InlineChunk",
        source.slice(opening.labelStart + 1, opening.labelEnd - 1),
        opening.labelStart + 1,
      ));
    }
    out.push(namedToken("BlockComponentLabelClose", "]", opening.labelEnd - 1));
  }
  if (opening.attributesStart !== void 0 && opening.attributesEnd !== void 0) {
    out.push(namedToken(
      "BlockComponentAttributes",
      source.slice(opening.attributesStart, opening.attributesEnd),
      opening.attributesStart,
    ));
  }
}

function parseYamlAttributes(
  token: NonNullable<ReturnType<typeof directBlockToken>>,
): Attributes {
  const value: unknown = parseYaml(token.text, { schema: "core" });
  if (value === null || value === void 0) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Component YAML props must be a mapping");
  }
  return value as Attributes;
}

function directRule(
  nodeId: number,
  offset: number,
  tokenBase: number,
  rule: string,
  context: Parameters<BlockNodeBuilder>[3],
): { id: number; offset: number; tokenBase: number } | undefined {
  const arena = context.view.arena;
  for (let index = 0; index < arena.childCount(nodeId); index++) {
    const child = arena.childAt(nodeId, index);
    if (child >= 0 && arena.ruleNameOf(child) === rule) {
      return {
        id: child,
        offset: offset + arena.childRelAt(nodeId, index),
        tokenBase: tokenBase + arena.childTokRelAt(nodeId, index),
      };
    }
  }
}

const buildBlockLabel: BlockNodeBuilder<Paragraph> = (nodeId, offset, tokenBase, context) => {
  const open = blockToken(nodeId, tokenBase, "BlockComponentLabelOpen", context);
  const close = blockToken(nodeId, tokenBase, "BlockComponentLabelClose", context);
  return {
    type: "paragraph",
    children: buildInlineChildren(nodeId, context, true),
    position: {
      start: tokenStart(open),
      end: tokenEnd(close),
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
      out.push(structuralToken("BlockComponentClose", lines[start].end));
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
    out.push(namedToken(
      "BlockComponentClose",
      source.slice(closing.offset, lines[closing.index].end),
      closing.offset,
    ));
    return closing.index + 1;
  };
}

export const blockRules: BlockFeature["rules"] = [
  {
    rule: "BlockComponentLabel",
    syntax: {
      kind: "frame",
      open: "BlockComponentLabelOpen",
      close: "BlockComponentLabelClose",
    },
    inlineContent: true,
    build: buildBlockLabel,
  },
  {
    rule: "BlockComponent",
    syntax: {
      kind: "block",
      open: "BlockComponentOpen",
      close: "BlockComponentClose",
    },
    build(nodeId, offset, tokenBase, context) {
      const open = blockToken(nodeId, tokenBase, "BlockComponentOpen", context);
      const close = blockToken(nodeId, tokenBase, "BlockComponentClose", context);
      const attributesToken = directBlockToken(nodeId, tokenBase, "BlockComponentAttributes", context);
      const parsed = attributesToken ? parseAttributes(context.source, tokenStart(attributesToken)) : void 0;
      const yamlToken = directBlockToken(nodeId, tokenBase, "BlockComponentYamlProps", context);
      const label = directRule(nodeId, offset, tokenBase, "BlockComponentLabel", context);
      const children: SpannedNode<RootContent>[] = [];
      if (label) {
        children.push(buildBlockLabel(label.id, label.offset, label.tokenBase, context));
      }
      children.push(...buildBlockChildren(nodeId, offset, tokenBase, context));
      return {
        type: "blockComponent",
        name: normalizeComponentName(open.text.slice(open.text.lastIndexOf(":") + 1).trim()),
        attributes: yamlToken
          ? { ...parseYamlAttributes(yamlToken), ...parsed?.attributes }
          : (parsed?.attributes ?? {}),
        position: {
          start: tokenStart(open),
          end: tokenEnd(close),
        },
        children,
      };
    },
  },
  {
    rule: "BlockComponentSlot",
    syntax: {
      kind: "block",
      open: "BlockComponentSlotOpen",
      close: "BlockComponentSlotClose",
    },
    build(nodeId, offset, tokenBase, context) {
      const open = blockToken(nodeId, tokenBase, "BlockComponentSlotOpen", context);
      const close = blockToken(nodeId, tokenBase, "BlockComponentSlotClose", context);
      const attributesToken = directBlockToken(nodeId, tokenBase, "BlockComponentAttributes", context);
      const parsed = attributesToken ? parseAttributes(context.source, tokenStart(attributesToken)) : void 0;
      const children = buildBlockChildren(nodeId, offset, tokenBase, context);
      return {
        type: "blockComponent",
        name: "template",
        attributes: {
          ...parsed?.attributes,
          name: normalizeComponentName(open.text.slice(1).trim()),
        },
        children,
        position: {
          start: tokenStart(open),
          end: tokenEnd(close),
        },
      };
    },
  },
];

export const blockStarts: BlockFeature["starts"] = [
  {
    codes: [58],
    interrupt(source, line, contentOffset) {
      return (
        blockOpeningAt(source, line, contentOffset, false) !== void 0 ||
        blockOpeningAt(source, line, contentOffset, true) !== void 0
      );
    },
    start: createBlockStart(false),
  },
  {
    codes: [58],
    start: createBlockStart(true),
  },
];
