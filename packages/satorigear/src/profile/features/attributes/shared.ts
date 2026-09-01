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

interface ParsedAttributes {
  attributes: Attributes;
  end: number;
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

  const readUntil = (stops: string): string => {
    const valueStart = offset;
    while (
      offset < limit &&
      source[offset] !== "\n" &&
      source[offset] !== "\r" &&
      !stops.includes(source[offset])
    ) {
      if (source[offset] === "\\" && offset + 1 < limit) {
        offset += 2;
      }
      else {
        offset++;
      }
    }
    return source.slice(valueStart, offset);
  };

  const readQuoted = (quote: string): string | undefined => {
    const valueStart = ++offset;
    while (
      offset < limit &&
      source[offset] !== "\n" &&
      source[offset] !== "\r" &&
      source[offset] !== quote
    ) {
      offset += source[offset] === "\\" && offset + 1 < limit ? 2 : 1;
    }
    if (source[offset] !== quote) {
      return;
    }
    const value = source.slice(valueStart, offset);
    offset++;
    return value;
  };

  const readBracketed = (close: string): string | undefined => {
    const valueStart = offset;
    const stack = [close];
    offset++;
    while (offset < limit && stack.length > 0) {
      const character = source[offset];
      if (character === "\n" || character === "\r") {
        return;
      }
      if (character === "\\" && offset + 1 < limit) {
        offset += 2;
        continue;
      }
      if (character === "\"" || character === "'" || character === "`") {
        if (readQuoted(character) === void 0) {
          return;
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
    return stack.length === 0 ? source.slice(valueStart, offset) : void 0;
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
      const value = readUntil(" #.}");
      if (!value) {
        return;
      }
      if (attributes) {
        assignAttribute(attributes, marker === "." ? "class" : "id", value);
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
    const rawName = source.slice(nameStart, offset);
    while (isHorizontalWhitespace(source[offset])) {
      offset++;
    }
    if (source[offset] !== "=") {
      if (attributes) {
        assignAttribute(attributes, rawName.startsWith(":") ? rawName : `:${rawName}`, "true");
      }
      continue;
    }
    offset++;
    while (isHorizontalWhitespace(source[offset])) {
      offset++;
    }
    const character = source[offset];
    let value: string | undefined;
    if (character === "\"" || character === "'" || character === "`") {
      value = readQuoted(character);
    }
    else if (brackets[character]) {
      value = readBracketed(brackets[character]);
    }
    else {
      value = readUntil(" }");
    }
    if (value === void 0 || value === "" && character !== "\"" && character !== "'" && character !== "`") {
      return;
    }
    if (attributes) {
      assignAttribute(attributes, rawName, value);
    }
  }
}

export function attributesEnd(source: string, start: number, limit = source.length): number | undefined {
  return scanAttributes(source, start, void 0, limit);
}

export function parseAttributes(source: string, start: number): ParsedAttributes | undefined {
  const attributes: Attributes = {};
  const end = scanAttributes(source, start, attributes);
  return end === void 0 ? void 0 : { attributes, end };
}
