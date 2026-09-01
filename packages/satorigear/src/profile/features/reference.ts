import { type BlockLines, isBlank } from "../../block/lines.ts";
import { BlockKind } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { leafBlockPosition } from "../../fragment/block.ts";
import { normalizeAssociationLabel, semanticText } from "../utils.ts";
import type { BlockScanContext } from "../../block/scanner.ts";
import type { SyntaxFeature } from "../types.ts";

interface LinkDefinitionFields {
  destination: string;
  label: string;
  title: string | undefined;
}

interface LinkDefinitionMatch {
  definitionKey: string;
  end: number;
  fields: LinkDefinitionFields;
}

function linkDefinitionAt(
  source: string,
  lines: BlockLines,
  startIndex: number,
  contentOffset: number,
  context: BlockScanContext,
): LinkDefinitionMatch | undefined {
  let offset = contentOffset + 1;
  const labelClose = source.indexOf("]", offset);
  if (
    labelClose >= 0 &&
    labelClose < lines.end(startIndex) &&
    source.charCodeAt(labelClose + 1) !== Character.Colon
  ) {
    let escapeStart = labelClose;
    while (
      escapeStart > offset &&
      source.charCodeAt(escapeStart - 1) === Character.ReverseSolidus
    ) {
      escapeStart--;
    }
    // The first unescaped close fixes the label boundary; only `]:` can form a definition.
    if (((labelClose - escapeStart) & 1) === 0) {
      return;
    }
  }
  let lineIndex = startIndex;
  let lookaheadEnd = -1;
  let label = "";
  let labelLength = 0;
  let labelHasContent = false;
  let labelStart = offset;

  // Funnel failures through one exit so only unrepresented lookahead becomes scanner state.
  parseDefinition: {
    scanLabel: while (true) {
      const lineEnd = lines.end(lineIndex);
      while (offset < lineEnd) {
        const code = source.charCodeAt(offset);
        if (code === Character.ReverseSolidus && offset + 1 < lineEnd) {
          labelHasContent = true;
          labelLength += 2;
          offset += 2;
          continue;
        }
        if (code === Character.LeftSquareBracket) {
          break parseDefinition;
        }
        if (code === Character.RightSquareBracket) {
          if (source.charCodeAt(offset + 1) === Character.Colon) {
            break scanLabel;
          }
          // Link labels cannot contain an unescaped "]",
          // so a "]" that does not introduce the colon never yields a definition.
          break parseDefinition;
        }
        if (code !== Character.Space && code !== Character.CharacterTabulation) {
          labelHasContent = true;
        }
        if (++labelLength > 999) {
          break parseDefinition;
        }
        offset++;
      }
      const nextLine = lineIndex + 1;
      lookaheadEnd = nextLine < lines.length ? lines.end(nextLine) : lines.next(lineIndex);
      if (nextLine >= lines.length || isBlank(source, lines, nextLine)) {
        break parseDefinition;
      }
      if (++labelLength > 999) {
        break parseDefinition;
      }
      label += source.slice(labelStart, lines.next(lineIndex));
      lineIndex++;
      offset = lines.start(lineIndex);
      labelStart = offset;
    }
    label += source.slice(labelStart, offset);
    if (!labelHasContent) {
      break parseDefinition;
    }
    offset += 2;

    const skipSpaces = (lineEnd: number): void => {
      while (offset < lineEnd && (source[offset] === " " || source[offset] === "\t")) {
        offset++;
      }
    };
    let lineEnd = lines.end(lineIndex);
    skipSpaces(lineEnd);
    if (offset === lineEnd) {
      const nextLine = lineIndex + 1;
      lookaheadEnd = nextLine < lines.length ? lines.end(nextLine) : lines.next(lineIndex);
      if (nextLine >= lines.length || isBlank(source, lines, nextLine)) {
        break parseDefinition;
      }
      lineIndex++;
      offset = lines.start(lineIndex);
      lineEnd = lines.end(lineIndex);
      skipSpaces(lineEnd);
    }

    let destination: string;
    if (source[offset] === "<") {
      offset++;
      const destinationStart = offset;
      while (offset < lineEnd && source[offset] !== ">") {
        if (source[offset] === "<") {
          break parseDefinition;
        }
        if (source[offset] === "\\" && offset + 1 < lineEnd) {
          offset += 2;
        }
        else {
          offset++;
        }
      }
      if (source[offset] !== ">") {
        break parseDefinition;
      }
      destination = source.slice(destinationStart, offset);
      offset++;
    }
    else {
      let depth = 0;
      const destinationStart = offset;
      while (offset < lineEnd) {
        const code = source.charCodeAt(offset);
        if (code === Character.Space || code === Character.CharacterTabulation) {
          break;
        }
        if (code === Character.ReverseSolidus && offset + 1 < lineEnd) {
          offset += 2;
          continue;
        }
        if (code === Character.LeftParenthesis) {
          if (++depth > 32) {
            break parseDefinition;
          }
        }
        else if (code === Character.RightParenthesis && --depth < 0) {
          break parseDefinition;
        }
        offset++;
      }
      if (offset === destinationStart || depth !== 0) {
        break parseDefinition;
      }
      destination = source.slice(destinationStart, offset);
    }

    const destinationLine = lineIndex;
    if (offset < lineEnd && source[offset] !== " " && source[offset] !== "\t") {
      break parseDefinition;
    }
    skipSpaces(lineEnd);
    let titleOnNextLine = false;
    if (offset === lineEnd && lineIndex + 1 < lines.length) {
      lookaheadEnd = lines.end(lineIndex + 1);
      lineIndex++;
      offset = lines.start(lineIndex);
      lineEnd = lines.end(lineIndex);
      skipSpaces(lineEnd);
      titleOnNextLine = true;
    }

    const closer = source[offset] === "("
      ? ")"
      : source[offset] === "\"" || source[offset] === "'"
        ? source[offset]
        : void 0;
    const definitionKey = normalizeAssociationLabel(label);
    const fields: LinkDefinitionFields = {
      destination,
      label,
      title: void 0,
    };
    if (!closer) {
      return { definitionKey, end: destinationLine + 1, fields };
    }
    offset++;
    let title = "";
    let titleStart = offset;
    let closed = false;
    while (lineIndex < lines.length) {
      lineEnd = lines.end(lineIndex);
      while (offset < lineEnd) {
        if (source[offset] === "\\" && offset + 1 < lineEnd) {
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
      const nextLine = lineIndex + 1;
      lookaheadEnd = nextLine < lines.length ? lines.end(nextLine) : lines.next(lineIndex);
      if (nextLine >= lines.length || isBlank(source, lines, nextLine)) {
        break;
      }
      title += source.slice(titleStart, lines.next(lineIndex));
      lineIndex++;
      offset = lines.start(lineIndex);
      titleStart = offset;
    }
    if (closed) {
      skipSpaces(lineEnd);
      if (offset === lineEnd) {
        fields.title = title;
        return { definitionKey, end: lineIndex + 1, fields };
      }
    }
    if (!titleOnNextLine) {
      break parseDefinition;
    }
    if (lookaheadEnd > lines.next(destinationLine + 1)) {
      context.retainLookahead(lookaheadEnd);
    }
    return { definitionKey, end: destinationLine + 1, fields };
  }
  if (lookaheadEnd >= 0) {
    context.retainLookahead(lookaheadEnd);
  }
}

export const feature: SyntaxFeature = {
  block: {
    builds: [
      {
        token: BlockKind.LinkDefinitionOpen,
        build(tokenStart, context) {
          const tokens = context.structure.tokens;
          // This rule only builds openers emitted with their parsed definition metadata.
          const fields = tokens.value<LinkDefinitionFields>(tokenStart)!;
          const definitionKey = tokens.definitionKey(tokenStart)!;
          return {
            type: "definition",
            identifier: definitionKey,
            label: semanticText(fields.label),
            url: semanticText(fields.destination),
            title: fields.title === void 0 ? null : semanticText(fields.title),
            position: leafBlockPosition(tokenStart, context),
          };
        },
      },
    ],
    starts: [
      {
        codes: [
          Character.LeftSquareBracket,
        ],
        start(source, lines, start, contentOffset, out, context) {
          const definition = linkDefinitionAt(source, lines, start, contentOffset, context);
          if (!definition) {
            return;
          }
          out.push(BlockKind.LinkDefinitionOpen, contentOffset, contentOffset, {
            definitionKey: definition.definitionKey,
            value: definition.fields,
          });
          let definitionEnd = contentOffset;
          for (let definitionLine = start; definitionLine < definition.end; definitionLine++) {
            definitionEnd = definitionLine + 1 < definition.end
              ? lines.next(definitionLine)
              : lines.end(definitionLine);
            out.push(BlockKind.LinkDefinitionChunk, lines.start(definitionLine), definitionEnd);
          }
          out.push(BlockKind.LinkDefinitionClose, definitionEnd, definitionEnd);
          return definition.end;
        },
      },
    ],
  },
};
