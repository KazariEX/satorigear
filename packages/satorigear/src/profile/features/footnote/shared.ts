import { Character } from "../../../constants/character.ts";
import { normalizeAssociationLabel } from "../../utils.ts";

const footnoteDefinitionPrefix = "footnote\0";

function isLabelWhitespace(code: number): boolean {
  return (
    code === Character.Space ||
    code === Character.CharacterTabulation ||
    code === Character.LineFeed ||
    code === Character.CarriageReturn
  );
}

export interface FootnoteLabel {
  definitionKey: string;
  end: number;
  label: string;
  normalizedLabel: string;
}

export function footnoteLabelAt(source: string, start: number, limit: number): FootnoteLabel | undefined {
  if (
    source.charCodeAt(start) !== Character.LeftSquareBracket ||
    source.charCodeAt(start + 1) !== Character.CircumflexAccent
  ) {
    return;
  }
  const labelStart = start + 2;
  let offset = labelStart;
  let length = 0;
  while (offset < limit) {
    const code = source.charCodeAt(offset);
    if (isLabelWhitespace(code)) {
      return;
    }
    if (code === Character.ReverseSolidus && offset + 1 < limit) {
      if (isLabelWhitespace(source.charCodeAt(offset + 1))) {
        return;
      }
      offset += 2;
      length += 2;
    }
    else if (code === Character.RightSquareBracket) {
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
      if (code === Character.LeftSquareBracket) {
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
