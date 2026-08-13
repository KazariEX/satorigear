import { BlockKind } from "../../block/kinds.ts";
import { type BlockLine, firstLineIndexAtOrAfter, indentOf, isBlank, lineIndent } from "../../block/lines.ts";
import { blockEnd, blockToken } from "../../fragment/block.ts";
import { InlineKind } from "../../inline/kinds.ts";
import {
  appendInlineToken,
  copyInlineToken,
  inlineTokenCount,
  inlineTokenEnd,
  inlineTokenFlags,
  inlineTokenKind,
  inlineTokenStart,
  inlineTokenStride,
  inlineTokenText,
} from "../../inline/tokens.ts";
import { normalizeAssociationLabel, splitReferenceTail } from "../utils.ts";
import { semanticText } from "./text.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
import type { PairedTokenConfig } from "../../inline/pairing.ts";
import type { InlineTokenTransform } from "../../inline/profile.ts";
import type { SyntaxFeature } from "../types.ts";

interface LinkDefinitionFields {
  definitionKey: string;
  destination: string;
  label: string;
  markerOffset: number;
  title: string | undefined;
}

interface LinkDefinitionMatch {
  end: number;
  fields: LinkDefinitionFields;
}

function linkDefinitionFields(tokens: BlockTokenStream, token: number): LinkDefinitionFields {
  const fields = tokens.value<LinkDefinitionFields>(token);
  if (tokens.kind(token) !== BlockKind.LinkDefinitionOpen || !fields) {
    throw new Error("Expected LinkDefinitionOpen token to contain parsed fields");
  }
  return fields;
}

function linkDefinitionAt(
  source: string,
  lines: readonly BlockLine[],
  startIndex: number,
): LinkDefinitionMatch | undefined {
  const indent = lineIndent(source, lines[startIndex]);
  if (!indent || source[indent.offset] !== "[") {
    return;
  }
  let lineIndex = startIndex;
  let offset = indent.offset + 1;
  let label = "";
  let labelLength = 0;
  let labelHasContent = false;
  let labelStart = offset;

  while (true) {
    const line = lines[lineIndex];
    if (!line || offset >= line.end) {
      if (!line || lineIndex + 1 >= lines.length || isBlank(source, lines[lineIndex + 1])) {
        return;
      }
      if (++labelLength > 999) {
        return;
      }
      label += source.slice(labelStart, line.next);
      lineIndex++;
      offset = lines[lineIndex].start;
      labelStart = offset;
      continue;
    }
    if (source[offset] === "\\" && offset + 1 < line.end) {
      labelHasContent = true;
      labelLength += 2;
      offset += 2;
      continue;
    }
    if (source[offset] === "[") {
      return;
    }
    if (source[offset] === "]" && source[offset + 1] === ":") {
      break;
    }
    if (source[offset] !== " " && source[offset] !== "\t") {
      labelHasContent = true;
    }
    if (++labelLength > 999) {
      return;
    }
    offset++;
  }
  label += source.slice(labelStart, offset);
  if (!labelHasContent) {
    return;
  }
  offset += 2;

  const skipSpaces = (): void => {
    while (offset < lines[lineIndex].end && (source[offset] === " " || source[offset] === "\t")) {
      offset++;
    }
  };
  skipSpaces();
  if (offset === lines[lineIndex].end) {
    if (lineIndex + 1 >= lines.length || isBlank(source, lines[lineIndex + 1])) {
      return;
    }
    lineIndex++;
    offset = lines[lineIndex].start;
    skipSpaces();
  }

  let destination: string;
  if (source[offset] === "<") {
    offset++;
    const destinationStart = offset;
    while (offset < lines[lineIndex].end && source[offset] !== ">") {
      if (source[offset] === "<") {
        return;
      }
      if (source[offset] === "\\" && offset + 1 < lines[lineIndex].end) {
        offset += 2;
      }
      else {
        offset++;
      }
    }
    if (source[offset] !== ">") {
      return;
    }
    destination = source.slice(destinationStart, offset);
    offset++;
  }
  else {
    let depth = 0;
    const destinationStart = offset;
    while (offset < lines[lineIndex].end && source[offset] !== " " && source[offset] !== "\t") {
      if (source[offset] === "\\" && offset + 1 < lines[lineIndex].end) {
        offset += 2;
        continue;
      }
      if (source[offset] === "(") {
        if (++depth > 32) {
          return;
        }
      }
      else if (source[offset] === ")" && --depth < 0) {
        return;
      }
      offset++;
    }
    if (offset === destinationStart || depth !== 0) {
      return;
    }
    destination = source.slice(destinationStart, offset);
  }

  const destinationLine = lineIndex;
  if (offset < lines[lineIndex].end && source[offset] !== " " && source[offset] !== "\t") {
    return;
  }
  skipSpaces();
  let titleOnNextLine = false;
  if (offset === lines[lineIndex].end && lineIndex + 1 < lines.length && !isBlank(source, lines[lineIndex + 1])) {
    lineIndex++;
    offset = lines[lineIndex].start;
    skipSpaces();
    titleOnNextLine = true;
  }

  const closer = source[offset] === "(" ? ")" : source[offset] === "\"" || source[offset] === "'" ? source[offset] : void 0;
  const fields: LinkDefinitionFields = {
    definitionKey: normalizeAssociationLabel(label),
    destination,
    label,
    markerOffset: indent.offset - lines[startIndex].start,
    title: void 0,
  };
  if (!closer) {
    return { end: destinationLine + 1, fields };
  }
  offset++;
  let title = "";
  let titleStart = offset;
  let closed = false;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    while (offset < line.end) {
      if (source[offset] === "\\" && offset + 1 < line.end) {
        offset += 2;
        continue;
      }
      if (source[offset] === closer) {
        title += source.slice(titleStart, offset);
        offset++;
        closed = true;
        break;
      }
      offset++;
    }
    if (closed) {
      break;
    }
    if (lineIndex + 1 >= lines.length || isBlank(source, lines[lineIndex + 1])) {
      break;
    }
    title += source.slice(titleStart, line.next);
    lineIndex++;
    offset = lines[lineIndex].start;
    titleStart = offset;
  }
  if (!closed) {
    return titleOnNextLine ? { end: destinationLine + 1, fields } : void 0;
  }
  skipSpaces();
  if (offset !== lines[lineIndex].end) {
    return titleOnNextLine ? { end: destinationLine + 1, fields } : void 0;
  }
  fields.title = title;
  return { end: lineIndex + 1, fields };
}

// Recover the one-token overlap between adjacent full-reference candidates before pairing.
const reassociateReferenceTails: InlineTokenTransform = (source, tokens, context) => {
  const count = inlineTokenCount(tokens);
  let result: number[] | undefined;
  for (let index = 0; index < count; index++) {
    const kind = inlineTokenKind(tokens, index);
    const label = kind === InlineKind.ReferenceTail ? inlineTokenText(source, tokens, index).slice(2, -1) : "";
    if (kind !== InlineKind.ReferenceTail || context.hasDefinition(normalizeAssociationLabel(label))) {
      if (result) {
        copyInlineToken(result, tokens, index);
      }
      continue;
    }
    const openerIndex = index + 1;
    if (
      openerIndex >= count ||
      inlineTokenKind(tokens, openerIndex) !== InlineKind.BracketOpen ||
      inlineTokenStart(tokens, openerIndex) !== inlineTokenEnd(tokens, index)
    ) {
      if (result) {
        copyInlineToken(result, tokens, index);
      }
      continue;
    }
    let closerIndex = index + 2;
    let nested = false;
    while (closerIndex < count && inlineTokenKind(tokens, closerIndex) !== InlineKind.ShortcutReferenceTail) {
      const closerKind = inlineTokenKind(tokens, closerIndex);
      nested ||= closerKind === InlineKind.BracketOpen || closerKind === InlineKind.ImageOpen;
      closerIndex++;
    }
    if (closerIndex === count || nested) {
      if (result) {
        copyInlineToken(result, tokens, index);
      }
      continue;
    }
    const nextLabel = source.slice(inlineTokenEnd(tokens, openerIndex), inlineTokenStart(tokens, closerIndex));
    if (!context.hasDefinition(normalizeAssociationLabel(nextLabel))) {
      if (result) {
        copyInlineToken(result, tokens, index);
      }
      continue;
    }
    if (!result) {
      result = [];
      for (let prefix = 0; prefix < index; prefix++) {
        copyInlineToken(result, tokens, prefix);
      }
    }
    const split = splitReferenceTail(tokens, index);
    result.push(...split.slice(0, -inlineTokenStride));
    const offset = inlineTokenEnd(tokens, index) - 1;
    appendInlineToken(
      result,
      InlineKind.ReferenceTail,
      offset,
      inlineTokenEnd(tokens, closerIndex),
      inlineTokenFlags(tokens, index),
    );
    index = closerIndex;
  }
  return result ?? tokens;
};

const activateReference: NonNullable<PairedTokenConfig["activate"]> = ({
  source,
  tokens,
  closerIndex,
  content,
  state,
}) => {
  const closer = inlineTokenText(source, tokens, closerIndex);
  const explicit = closer.startsWith("][") ? closer.slice(2, -1) : "";
  return state.hasDefinition(normalizeAssociationLabel(explicit || content));
};

const markdownBracketPairs: readonly PairedTokenConfig[] = [
  {
    opener: InlineKind.BracketOpen,
    closer: InlineKind.LinkTail,
    open: InlineKind.LinkOpen,
    close: InlineKind.LinkClose,
    deactivateEarlier: [InlineKind.BracketOpen],
    isolateDelimiters: true,
  },
  {
    opener: InlineKind.ImageOpen,
    closer: InlineKind.LinkTail,
    open: InlineKind.ImageLinkOpen,
    close: InlineKind.ImageLinkClose,
  },
  {
    opener: InlineKind.BracketOpen,
    closer: InlineKind.ReferenceTail,
    open: InlineKind.ReferenceOpen,
    close: InlineKind.ReferenceClose,
    deactivateEarlier: [InlineKind.BracketOpen],
    isolateDelimiters: true,
    activate: activateReference,
    splitUnmatchedCloser: splitReferenceTail,
  },
  {
    opener: InlineKind.BracketOpen,
    closer: InlineKind.ShortcutReferenceTail,
    open: InlineKind.ReferenceOpen,
    close: InlineKind.ReferenceClose,
    deactivateEarlier: [InlineKind.BracketOpen],
    isolateDelimiters: true,
    activate: activateReference,
    content: {
      requireNonWhitespace: true,
      maxCharacters: 999,
      forbidTokens: [InlineKind.BracketOpen, InlineKind.ImageOpen],
    },
  },
  {
    opener: InlineKind.ImageOpen,
    closer: InlineKind.ReferenceTail,
    open: InlineKind.ImageReferenceOpen,
    close: InlineKind.ImageReferenceClose,
    isolateDelimiters: true,
    activate: activateReference,
    splitUnmatchedCloser: splitReferenceTail,
  },
  {
    opener: InlineKind.ImageOpen,
    closer: InlineKind.ShortcutReferenceTail,
    open: InlineKind.ImageReferenceOpen,
    close: InlineKind.ImageReferenceClose,
    isolateDelimiters: true,
    activate: activateReference,
    content: {
      requireNonWhitespace: true,
      maxCharacters: 999,
      forbidTokens: [InlineKind.BracketOpen, InlineKind.ImageOpen],
    },
  },
];

export const feature: SyntaxFeature = {
  block: {
    restart(source, lines, changedStart, changedEnd) {
      const end = firstLineIndexAtOrAfter(lines, Math.max(1, changedEnd));
      let candidate: number | undefined;
      for (let index = end - 1; index >= 0; index--) {
        const line = lines[index];
        if (isBlank(source, line)) {
          break;
        }
        const indent = indentOf(source, line, 3);
        if (source[indent.offset] === "[") {
          candidate = line.start;
        }
      }
      return candidate;
    },
    rules: [
      {
        rule: "LinkDefinition",
        syntax: {
          kind: "block",
          open: BlockKind.LinkDefinitionOpen,
          close: BlockKind.LinkDefinitionClose,
        },
        build(nodeId, offset, tokenBase, context) {
          const token = blockToken(nodeId, tokenBase, BlockKind.LinkDefinitionOpen, context);
          const fields = linkDefinitionFields(context.arena.tokens, token);
          return {
            type: "definition",
            identifier: fields.definitionKey.toLowerCase(),
            label: semanticText(fields.label),
            url: semanticText(fields.destination),
            title: fields.title === void 0 ? null : semanticText(fields.title),
            position: {
              start: context.arena.tokens.start(token) + fields.markerOffset,
              end: blockEnd(nodeId, offset, context),
            },
          };
        },
        definitionKey(tokens, token) {
          return linkDefinitionFields(tokens, token).definitionKey;
        },
      },
    ],
    starts: [
      {
        codes: [91],
        start(source, lines, start, out) {
          const definition = linkDefinitionAt(source, lines, start);
          if (!definition) {
            return;
          }
          const line = lines[start];
          out.push(BlockKind.LinkDefinitionOpen, line.start, line.start, { value: definition.fields });
          for (let definitionLine = start; definitionLine < definition.end; definitionLine++) {
            const current = lines[definitionLine];
            const end = definitionLine + 1 < definition.end ? current.next : current.end;
            out.push(BlockKind.LinkDefinitionChunk, current.start, end);
          }
          const end = lines[definition.end - 1].end;
          out.push(BlockKind.LinkDefinitionClose, end, end);
          return definition.end;
        },
      },
    ],
  },
  inline: {
    resolution: {
      postTransform: reassociateReferenceTails,
      pairs: markdownBracketPairs,
    },
  },
};
