import { trimLineWhitespaceStart } from "../../../block/lines.ts";
import { Character } from "../../../constants/character.ts";
import { isAsciiDigit, isAsciiLetter } from "../../utils.ts";
import type { Attributes, AttributeValue } from "./types.ts";

const brackets = {
  [Character.LeftSquareBracket as number]: Character.RightSquareBracket,
  [Character.LeftCurlyBracket as number]: Character.RightCurlyBracket,
  [Character.LeftParenthesis as number]: Character.RightParenthesis,
};

const stops1 = new Set([
  Character.Space,
  Character.NumberSign,
  Character.FullStop,
  Character.RightCurlyBracket,
]);
const stops2 = new Set([
  Character.Space,
  Character.RightCurlyBracket,
]);

function assignAttribute(attributes: Attributes, name: string, value: AttributeValue): void {
  if (name === "class" && typeof value === "string" && typeof attributes.class === "string") {
    attributes.class += ` ${value}`;
  }
  else {
    attributes[name] = value;
  }
}

export function mergeAttributes(target: Attributes, source: Attributes): void {
  for (const key in source) {
    assignAttribute(target, key, source[key]);
  }
}

function scanAttributes(
  source: string,
  start: number,
  attributes?: Attributes,
  limit = source.length,
): number | undefined {
  if (
    source.charCodeAt(start) !== Character.LeftCurlyBracket ||
    source.charCodeAt(start + 1) === Character.LeftCurlyBracket
  ) {
    return;
  }
  let offset = start + 1;

  // Scans only advance ranges; validation never materializes attribute strings.
  const scanUntil = (stops: Set<number>): void => {
    while (offset < limit) {
      const code = source.charCodeAt(offset);
      if (code === Character.LineFeed || code === Character.CarriageReturn || stops.has(code)) {
        break;
      }
      offset += code === Character.ReverseSolidus && offset + 1 < limit ? 2 : 1;
    }
  };

  const scanQuoted = (quote: number): boolean => {
    offset++;
    while (offset < limit) {
      const character = source.charCodeAt(offset);
      if (
        character === quote ||
        character === Character.LineFeed ||
        character === Character.CarriageReturn
      ) {
        break;
      }
      offset += character === Character.ReverseSolidus && offset + 1 < limit ? 2 : 1;
    }
    if (source.charCodeAt(offset) !== quote) {
      return false;
    }
    offset++;
    return true;
  };

  const scanBracketed = (close: number): boolean => {
    const stack = [close];
    offset++;
    while (offset < limit && stack.length > 0) {
      const code = source.charCodeAt(offset);
      if (code === Character.LineFeed || code === Character.CarriageReturn) {
        return false;
      }
      if (code === Character.ReverseSolidus && offset + 1 < limit) {
        offset += 2;
        continue;
      }
      if (
        code === Character.QuotationMark ||
        code === Character.Apostrophe ||
        code === Character.GraveAccent
      ) {
        if (!scanQuoted(code)) {
          return false;
        }
        continue;
      }
      const nested = brackets[code];
      if (nested) {
        stack.push(nested);
      }
      else if (code === stack.at(-1)) {
        stack.pop();
      }
      offset++;
    }
    return stack.length === 0;
  };

  while (offset < limit) {
    offset = trimLineWhitespaceStart(source, offset, limit);
    if (source.charCodeAt(offset) === Character.RightCurlyBracket) {
      return offset + 1;
    }
    const marker = source.charCodeAt(offset);
    if (marker === Character.FullStop || marker === Character.NumberSign) {
      offset++;
      const valueStart = offset;
      scanUntil(stops1);
      if (offset === valueStart) {
        return;
      }
      if (attributes) {
        assignAttribute(
          attributes,
          marker === Character.FullStop ? "class" : "id",
          source.slice(valueStart, offset),
        );
      }
      continue;
    }

    const nameStart = offset;
    if (source.charCodeAt(offset) === Character.Colon) {
      offset++;
    }
    let code = source.charCodeAt(offset);
    if (!isAsciiLetter(code) && code !== Character.LowLine) {
      return;
    }
    offset++;
    while (true) {
      code = source.charCodeAt(offset);
      if (
        !isAsciiLetter(code) &&
        !isAsciiDigit(code) &&
        code !== Character.LowLine &&
        code !== Character.HyphenMinus
      ) {
        break;
      }
      offset++;
    }
    const nameEnd = offset;
    offset = trimLineWhitespaceStart(source, offset, limit);
    if (source.charCodeAt(offset) !== Character.EqualsSign) {
      if (attributes) {
        const name = source.slice(nameStart, nameEnd);
        assignAttribute(
          attributes,
          source.charCodeAt(nameStart) === Character.Colon ? name : `:${name}`,
          "true",
        );
      }
      continue;
    }
    offset++;
    offset = trimLineWhitespaceStart(source, offset, limit);
    const character = source.charCodeAt(offset);
    let valueStart = offset;
    let valueEnd: number;
    if (
      character === Character.QuotationMark ||
      character === Character.Apostrophe ||
      character === Character.GraveAccent
    ) {
      if (!scanQuoted(character)) {
        return;
      }
      valueStart++;
      valueEnd = offset - 1;
    }
    else if (character in brackets) {
      if (!scanBracketed(brackets[character])) {
        return;
      }
      valueEnd = offset;
    }
    else {
      scanUntil(stops2);
      valueEnd = offset;
      if (valueEnd === valueStart) {
        return;
      }
    }
    if (attributes) {
      assignAttribute(
        attributes,
        source.slice(nameStart, nameEnd),
        source.slice(valueStart, valueEnd),
      );
    }
  }
}

export function attributesEnd(source: string, start: number, limit = source.length): number | undefined {
  return scanAttributes(source, start, void 0, limit);
}

/** Materializes syntax previously accepted by {@link attributesEnd}. */
export function parseAttributes(source: string, start: number): Attributes {
  const attributes: Attributes = {};
  scanAttributes(source, start, attributes);
  return attributes;
}
