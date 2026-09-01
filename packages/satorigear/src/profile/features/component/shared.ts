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
  let result = "";
  let partLength = 0;
  let previousUpper: boolean | undefined;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    const code = value.charCodeAt(index);
    if (
      code === Character.HyphenMinus ||
      code === Character.LowLine ||
      code === Character.Solidus ||
      code === Character.FullStop
    ) {
      partLength = 0;
      previousUpper = void 0;
      continue;
    }
    const upper = isAsciiLetter(code) ? code <= Character.LatinCapitalLetterZ : void 0;
    const next = value.charCodeAt(index + 1);
    // Start a part after separators, at camel humps, or before the last capital in `HTMLParser`.
    if (
      result && (
        partLength === 0 || upper === true && (
          previousUpper === false ||
          next >= Character.LatinSmallLetterA && next <= Character.LatinSmallLetterZ
        )
      )
    ) {
      result += "-";
    }
    result += character;
    partLength++;
    previousUpper = upper;
  }
  return result.toLowerCase();
}
