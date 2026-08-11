import type { Definition } from "mdast";
import { type BlockLine, indentOf, isBlank, lineIndent } from "../../block/lines.ts";
import { namedToken, structuralToken } from "../../block/tokens.ts";
import { inlineKind } from "../../inline/kinds.ts";
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
import { blockEnd, blockToken, withSpan } from "../../mdast.ts";
import { normalizeAssociationLabel, splitReferenceTail } from "../utils.ts";
import { semanticText } from "./text.ts";
import type { BlockToken } from "../../block/tokens.ts";
import type { PairedTokenConfig } from "../../inline/pairing.ts";
import type { InlineTokenRewrite } from "../../inline/profile.ts";
import type {
  SyntaxFeature,
} from "../types.ts";

interface LinkDefinitionFields {
  definitionKey: string;
  destination: string;
  label: string;
  markerOffset: number;
  title: string | undefined;
}

const referenceTailKind = inlineKind("ReferenceTail");
const bracketOpenKind = inlineKind("BracketOpen");
const shortcutTailKind = inlineKind("ShortcutReferenceTail");
const imageOpenKind = inlineKind("ImageOpen");

interface LinkDefinitionOpenToken extends BlockToken {
  linkDefinition: LinkDefinitionFields;
}

interface LinkDefinitionMatch {
  end: number;
  fields: LinkDefinitionFields;
}

function linkDefinitionOpen(offset: number, fields: LinkDefinitionFields): LinkDefinitionOpenToken {
  return { ...structuralToken("LinkDefinitionOpen", offset), linkDefinition: fields };
}

function linkDefinitionFields(token: BlockToken): LinkDefinitionFields {
  const fields = (token as Partial<LinkDefinitionOpenToken>).linkDefinition;
  if (token.type !== "LinkDefinitionOpen" || !fields) {
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
    if (!/[ \t]/.test(source[offset])) {
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
const reassociateReferenceTails: InlineTokenRewrite = (source, tokens, context) => {
  const count = inlineTokenCount(tokens);
  let result: number[] | undefined;
  for (let index = 0; index < count; index++) {
    const kind = inlineTokenKind(tokens, index);
    const label = kind === referenceTailKind ? inlineTokenText(source, tokens, index).slice(2, -1) : "";
    if (kind !== referenceTailKind || context.hasDefinition(normalizeAssociationLabel(label))) {
      if (result) {
        copyInlineToken(result, tokens, index);
      }
      continue;
    }
    const openerIndex = index + 1;
    if (
      openerIndex >= count ||
      inlineTokenKind(tokens, openerIndex) !== bracketOpenKind ||
      inlineTokenStart(tokens, openerIndex) !== inlineTokenEnd(tokens, index)
    ) {
      if (result) {
        copyInlineToken(result, tokens, index);
      }
      continue;
    }
    let closerIndex = index + 2;
    let nested = false;
    while (closerIndex < count && inlineTokenKind(tokens, closerIndex) !== shortcutTailKind) {
      const closerKind = inlineTokenKind(tokens, closerIndex);
      nested ||= closerKind === bracketOpenKind || closerKind === imageOpenKind;
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
      referenceTailKind,
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
    opener: "BracketOpen",
    closer: "LinkTail",
    open: "LinkOpen",
    close: "LinkClose",
    deactivateEarlier: ["BracketOpen"],
    isolateDelimiters: true,
  },
  {
    opener: "ImageOpen",
    closer: "LinkTail",
    open: "ImageLinkOpen",
    close: "ImageLinkClose",
  },
  {
    opener: "BracketOpen",
    closer: "ReferenceTail",
    open: "ReferenceOpen",
    close: "ReferenceClose",
    deactivateEarlier: ["BracketOpen"],
    isolateDelimiters: true,
    activate: activateReference,
    splitUnmatchedCloser: splitReferenceTail,
  },
  {
    opener: "BracketOpen",
    closer: "ShortcutReferenceTail",
    open: "ReferenceOpen",
    close: "ReferenceClose",
    deactivateEarlier: ["BracketOpen"],
    isolateDelimiters: true,
    activate: activateReference,
    content: {
      requireNonWhitespace: true,
      maxCharacters: 999,
      forbidTokens: ["BracketOpen", "ImageOpen"],
    },
  },
  {
    opener: "ImageOpen",
    closer: "ReferenceTail",
    open: "ImageReferenceOpen",
    close: "ImageReferenceClose",
    isolateDelimiters: true,
    activate: activateReference,
    splitUnmatchedCloser: splitReferenceTail,
  },
  {
    opener: "ImageOpen",
    closer: "ShortcutReferenceTail",
    open: "ImageReferenceOpen",
    close: "ImageReferenceClose",
    isolateDelimiters: true,
    activate: activateReference,
    content: {
      requireNonWhitespace: true,
      maxCharacters: 999,
      forbidTokens: ["BracketOpen", "ImageOpen"],
    },
  },
];

export const feature: SyntaxFeature = {
  block: {
    restart(source, lines, changedStart, changedEnd) {
      let low = 0;
      let high = lines.length;
      const offset = Math.max(0, changedEnd - 1);
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (lines[middle].start <= offset) {
          low = middle + 1;
        }
        else {
          high = middle;
        }
      }

      let candidate: number | undefined;
      for (let index = Math.min(low, lines.length) - 1; index >= 0; index--) {
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
          open: "LinkDefinitionOpen",
          close: "LinkDefinitionClose",
        },
        project(nodeId, offset, tokenBase, context) {
          const token = blockToken(nodeId, tokenBase, "LinkDefinitionOpen", context);
          const fields = linkDefinitionFields(token);
          return withSpan<Definition>({
            type: "definition",
            identifier: fields.definitionKey.toLowerCase(),
            label: semanticText(fields.label),
            url: semanticText(fields.destination),
            title: fields.title === void 0 ? null : semanticText(fields.title),
          }, token.offset + fields.markerOffset, blockEnd(nodeId, offset, context));
        },
        definitionKey(token) {
          return linkDefinitionFields(token).definitionKey;
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
          out.push(linkDefinitionOpen(line.start, definition.fields));
          for (let definitionLine = start; definitionLine < definition.end; definitionLine++) {
            const current = lines[definitionLine];
            const end = definitionLine + 1 < definition.end ? current.next : current.end;
            out.push(namedToken("LinkDefinitionChunk", source.slice(current.start, end), current.start));
          }
          out.push(structuralToken("LinkDefinitionClose", lines[definition.end - 1].end));
          return definition.end;
        },
      },
    ],
  },
  inline: {
    finalizeTokens: reassociateReferenceTails,
    pairs: markdownBracketPairs,
  },
};
