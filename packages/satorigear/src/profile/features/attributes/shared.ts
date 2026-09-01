import { Character } from "../../../constants/character.ts";
import { isAsciiDigit, isAsciiLetter } from "../../utils.ts";
import type { Attributes, AttributeValue } from "./types.ts";

const brackets: Record<string, string> = { "[": "]", "{": "}", "(": ")" };

function isHorizontalWhitespace(character: string): boolean {
  return character === " " || character === "\t";
}

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
  if (source[start] !== "{" || source[start + 1] === "{") {
    return;
  }
  let offset = start + 1;

  // Scans only advance ranges; validation never materializes attribute strings.
  const scanUntil = (stops: string): void => {
    while (offset < limit) {
      const character = source[offset];
      if (character === "\n" || character === "\r" || stops.includes(character)) {
        break;
      }
      offset += character === "\\" && offset + 1 < limit ? 2 : 1;
    }
  };

  const scanQuoted = (quote: string): boolean => {
    offset++;
    while (offset < limit) {
      const character = source[offset];
      if (character === "\n" || character === "\r" || character === quote) {
        break;
      }
      offset += character === "\\" && offset + 1 < limit ? 2 : 1;
    }
    if (source[offset] !== quote) {
      return false;
    }
    offset++;
    return true;
  };

  const scanBracketed = (close: string): boolean => {
    const stack = [close];
    offset++;
    while (offset < limit && stack.length > 0) {
      const character = source[offset];
      if (character === "\n" || character === "\r") {
        return false;
      }
      if (character === "\\" && offset + 1 < limit) {
        offset += 2;
        continue;
      }
      if (character === "\"" || character === "'" || character === "`") {
        if (!scanQuoted(character)) {
          return false;
        }
        continue;
      }
      const nestedClose = brackets[character];
      if (nestedClose) {
        stack.push(nestedClose);
      }
      else if (character === stack.at(-1)) {
        stack.pop();
      }
      offset++;
    }
    return stack.length === 0;
  };

  while (offset < limit) {
    while (isHorizontalWhitespace(source[offset])) {
      offset++;
    }
    if (source[offset] === "}") {
      return offset + 1;
    }
    const marker = source[offset];
    if (marker === "." || marker === "#") {
      offset++;
      const valueStart = offset;
      scanUntil(" #.}");
      if (offset === valueStart) {
        return;
      }
      if (attributes) {
        assignAttribute(
          attributes,
          marker === "." ? "class" : "id",
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
    while (isHorizontalWhitespace(source[offset])) {
      offset++;
    }
    if (source[offset] !== "=") {
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
    while (isHorizontalWhitespace(source[offset])) {
      offset++;
    }
    const character = source[offset];
    let valueStart = offset;
    let valueEnd: number;
    if (character === "\"" || character === "'" || character === "`") {
      if (!scanQuoted(character)) {
        return;
      }
      valueStart++;
      valueEnd = offset - 1;
    }
    else if (brackets[character]) {
      if (!scanBracketed(brackets[character])) {
        return;
      }
      valueEnd = offset;
    }
    else {
      scanUntil(" }");
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
