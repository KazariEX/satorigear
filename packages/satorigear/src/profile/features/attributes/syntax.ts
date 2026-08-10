import type { Attributes, AttributeValue } from "./types.ts";

const brackets: Record<string, string> = { "[": "]", "{": "}", "(": ")" };

function isAsciiLetter(character: string): boolean {
  if (!character) {
    return false;
  }
  const code = character.charCodeAt(0);
  return code >= 65 && code <= 90 || code >= 97 && code <= 122;
}

function isAsciiDigit(character: string): boolean {
  if (!character) {
    return false;
  }
  const code = character.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isSpace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

export function componentNameEnd(source: string, start: number, block: boolean): number | undefined {
  if (!isAsciiLetter(source[start]) && source[start] !== "$") {
    return;
  }
  let end = start + 1;
  while (end < source.length) {
    const character = source[end];
    if (
      !isAsciiLetter(character) &&
      !isAsciiDigit(character) &&
      character !== "$" &&
      character !== "_" &&
      character !== "-" && (
        !block || character !== "."
      )
    ) {
      break;
    }
    end++;
  }
  return end;
}

export function normalizeComponentName(value: string): string {
  const parts: string[] = [];
  let part = "";
  let previousUpper: boolean | undefined;
  for (const character of value) {
    if (character === "-" || character === "_" || character === "/" || character === ".") {
      if (part) {
        parts.push(part);
        part = "";
      }
      previousUpper = void 0;
      continue;
    }
    const upper = isAsciiLetter(character) ? character === character.toUpperCase() : void 0;
    if (previousUpper === false && upper === true) {
      parts.push(part);
      part = character;
    }
    else if (previousUpper === true && upper === false && part.length > 1) {
      parts.push(part.slice(0, -1));
      part = part.at(-1)! + character;
    }
    else {
      part += character;
    }
    previousUpper = upper;
  }
  if (part) {
    parts.push(part);
  }
  return parts.map((value) => value.toLowerCase()).join("-");
}

export function assignAttribute(attributes: Attributes, name: string, value: AttributeValue): void {
  if (name === "class" && typeof value === "string" && typeof attributes.class === "string") {
    attributes.class += ` ${value}`;
  }
  else {
    attributes[name] = value;
  }
}

export interface ParsedAttributes {
  attributes: Attributes;
  end: number;
}

export function closingBracket(source: string, start: number): number | undefined {
  if (source[start] !== "[") {
    return;
  }
  let depth = 0;
  for (let offset = start + 1; offset < source.length; offset++) {
    if (source[offset] === "\\" && offset + 1 < source.length) {
      offset++;
    }
    else if (source[offset] === "[") {
      depth++;
    }
    else if (source[offset] === "]") {
      if (depth === 0) {
        return offset;
      }
      depth--;
    }
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

  const readUntil = (stops: string): string => {
    const valueStart = offset;
    while (offset < limit && !stops.includes(source[offset])) {
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
    while (offset < limit && source[offset] !== quote) {
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
    while (isSpace(source[offset])) {
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
    if (source[offset] === ":") {
      offset++;
    }
    if (!isAsciiLetter(source[offset]) && source[offset] !== "_") {
      return;
    }
    offset++;
    while (
      isAsciiLetter(source[offset]) ||
      isAsciiDigit(source[offset]) ||
      source[offset] === "_" ||
      source[offset] === "-"
    ) {
      offset++;
    }
    const rawName = source.slice(nameStart, offset);
    while (isSpace(source[offset])) {
      offset++;
    }
    if (source[offset] !== "=") {
      if (attributes) {
        assignAttribute(attributes, rawName.startsWith(":") ? rawName : `:${rawName}`, "true");
      }
      continue;
    }
    offset++;
    while (isSpace(source[offset])) {
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
