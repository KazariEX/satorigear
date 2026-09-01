import { Character } from "../../../constants/character.ts";
import { isAsciiDigit, isAsciiLetter } from "../../utils.ts";

export function componentNameEnd(source: string, start: number, block: boolean): number | undefined {
  let code = source.charCodeAt(start);
  if (!isAsciiLetter(code) && code !== Character.DollarSign) {
    return;
  }
  let end = start + 1;
  while (end < source.length) {
    code = source.charCodeAt(end);
    if (
      !isAsciiLetter(code) &&
      !isAsciiDigit(code) &&
      code !== Character.DollarSign &&
      code !== Character.LowLine &&
      code !== Character.HyphenMinus && (
        !block || code !== Character.FullStop
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
    const code = character.charCodeAt(0);
    if (
      code === Character.HyphenMinus ||
      code === Character.LowLine ||
      code === Character.Solidus ||
      code === Character.FullStop
    ) {
      if (part) {
        parts.push(part);
        part = "";
      }
      previousUpper = void 0;
      continue;
    }
    const upper = isAsciiLetter(code) ? code <= Character.LatinCapitalLetterZ : void 0;
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
