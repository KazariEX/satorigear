import { normalizeAssociationLabel } from "../../utils.ts";

const footnoteDefinitionPrefix = "footnote\0";

export interface FootnoteLabel {
  definitionKey: string;
  end: number;
  label: string;
  normalizedLabel: string;
}

export function footnoteLabelAt(source: string, start: number, limit: number): FootnoteLabel | undefined {
  if (source[start] !== "[" || source[start + 1] !== "^") {
    return;
  }
  const labelStart = start + 2;
  let offset = labelStart;
  let length = 0;
  while (offset < limit) {
    const character = source[offset];
    if (character === " " || character === "\t" || character === "\n" || character === "\r") {
      return;
    }
    if (character === "\\" && offset + 1 < limit) {
      const escaped = source[offset + 1];
      if (escaped === " " || escaped === "\t" || escaped === "\n" || escaped === "\r") {
        return;
      }
      offset += 2;
      length += 2;
    }
    else if (character === "]") {
      if (length === 0) {
        return;
      }
      const label = source.slice(labelStart, offset);
      const normalizedLabel = normalizeAssociationLabel(label);
      return {
        definitionKey: footnoteDefinitionPrefix + normalizedLabel,
        end: offset + 1,
        label,
        normalizedLabel,
      };
    }
    else {
      if (character === "[") {
        return;
      }
      offset++;
      length++;
    }
    if (length > 999) {
      return;
    }
  }
}
