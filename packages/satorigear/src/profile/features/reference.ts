import { type BlockLine, isBlank } from "../../block/lines.ts";
import { BlockKind, BlockRule } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { blockEnd } from "../../fragment/block.ts";
import { normalizeAssociationLabel } from "../utils.ts";
import { semanticText } from "./text.ts";
import type { BlockScanContext } from "../../block/scanner.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
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
  contentOffset: number,
  context: BlockScanContext,
): LinkDefinitionMatch | undefined {
  let lineIndex = startIndex;
  let lookaheadEnd = -1;
  let offset = contentOffset + 1;
  let label = "";
  let labelLength = 0;
  let labelHasContent = false;
  let labelStart = offset;

  // Funnel failures through one exit so only unrepresented lookahead becomes scanner state.
  parseDefinition: {
    scanLabel: while (true) {
      const line = lines[lineIndex];
      while (offset < line.end) {
        const code = source.charCodeAt(offset);
        if (code === Character.ReverseSolidus && offset + 1 < line.end) {
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
      const nextLine = lines[lineIndex + 1];
      lookaheadEnd = nextLine?.end ?? line.next;
      if (!nextLine || isBlank(source, nextLine)) {
        break parseDefinition;
      }
      if (++labelLength > 999) {
        break parseDefinition;
      }
      label += source.slice(labelStart, line.next);
      lineIndex++;
      offset = lines[lineIndex].start;
      labelStart = offset;
    }
    label += source.slice(labelStart, offset);
    if (!labelHasContent) {
      break parseDefinition;
    }
    offset += 2;

    const skipSpaces = (): void => {
      while (offset < lines[lineIndex].end && (source[offset] === " " || source[offset] === "\t")) {
        offset++;
      }
    };
    skipSpaces();
    if (offset === lines[lineIndex].end) {
      const nextLine = lines[lineIndex + 1];
      lookaheadEnd = nextLine?.end ?? lines[lineIndex].next;
      if (!nextLine || isBlank(source, nextLine)) {
        break parseDefinition;
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
          break parseDefinition;
        }
        if (source[offset] === "\\" && offset + 1 < lines[lineIndex].end) {
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
      while (offset < lines[lineIndex].end) {
        const code = source.charCodeAt(offset);
        if (code === Character.Space || code === Character.CharacterTabulation) {
          break;
        }
        if (code === Character.ReverseSolidus && offset + 1 < lines[lineIndex].end) {
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
    if (offset < lines[lineIndex].end && source[offset] !== " " && source[offset] !== "\t") {
      break parseDefinition;
    }
    skipSpaces();
    let titleOnNextLine = false;
    if (offset === lines[lineIndex].end && lineIndex + 1 < lines.length) {
      lookaheadEnd = lines[lineIndex + 1].end;
      lineIndex++;
      offset = lines[lineIndex].start;
      skipSpaces();
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
      const nextLine = lines[lineIndex + 1];
      lookaheadEnd = nextLine?.end ?? line.next;
      if (!nextLine || isBlank(source, nextLine)) {
        break;
      }
      title += source.slice(titleStart, line.next);
      lineIndex++;
      offset = lines[lineIndex].start;
      titleStart = offset;
    }
    if (closed) {
      skipSpaces();
      if (offset === lines[lineIndex].end) {
        fields.title = title;
        return { definitionKey, end: lineIndex + 1, fields };
      }
    }
    if (!titleOnNextLine) {
      break parseDefinition;
    }
    if (lookaheadEnd > lines[destinationLine + 1].next) {
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
    rules: [
      {
        rule: BlockRule.LinkDefinition,
        syntax: {
          kind: "block",
          open: BlockKind.LinkDefinitionOpen,
          close: BlockKind.LinkDefinitionClose,
        },
        build(tokenStart, context) {
          const tokens = context.structure.tokens;
          const fields = linkDefinitionFields(tokens, tokenStart);
          const definitionKey = tokens.definitionKey(tokenStart);
          if (definitionKey === void 0) {
            throw new Error("Expected LinkDefinitionOpen token to contain a definition key");
          }
          return {
            type: "definition",
            identifier: definitionKey.toLowerCase(),
            label: semanticText(fields.label),
            url: semanticText(fields.destination),
            title: fields.title === void 0 ? null : semanticText(fields.title),
            position: {
              start: context.structure.tokens.start(tokenStart),
              end: blockEnd(tokenStart, context),
            },
          };
        },
      },
    ],
    starts: [
      {
        codes: [
          Character.LeftSquareBracket,
        ],
        start(source, lines, start, out, contentOffset, context) {
          const definition = linkDefinitionAt(source, lines, start, contentOffset, context);
          if (!definition) {
            return;
          }
          out.push(BlockKind.LinkDefinitionOpen, contentOffset, contentOffset, {
            definitionKey: definition.definitionKey,
            value: definition.fields,
          });
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
};
