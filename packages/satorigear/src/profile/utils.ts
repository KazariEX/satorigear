import { decodeString } from "micromark-util-decode-string";
import { Character } from "../constants/character.ts";

const inlineColonBoundary = /[ \t\n\r\p{sc=Han}\p{sc=Hira}\p{sc=Kana}\p{sc=Hang}\p{P}]/u;

export function isAsciiLetter(code: number): boolean {
  return (
    code >= Character.LatinCapitalLetterA && code <= Character.LatinCapitalLetterZ ||
    code >= Character.LatinSmallLetterA && code <= Character.LatinSmallLetterZ
  );
}

export function isAsciiDigit(code: number): boolean {
  return code >= Character.DigitZero && code <= Character.DigitNine;
}

export function isMarkdownWhitespace(code: number): boolean {
  return (
    code === Character.CharacterTabulation ||
    code === Character.LineFeed ||
    code === Character.CarriageReturn ||
    code === Character.Space
  );
}

export function hasInlineColonBoundary(source: string, start: number): boolean {
  if (start <= 0) {
    return true;
  }
  const previous = source[start - 1];
  return previous !== ":" && inlineColonBoundary.test(previous);
}

export function semanticText(value: string): string {
  return value.includes("\\") || value.includes("&") ? decodeString(value) : value;
}

export function normalizeAssociationLabel(label: string): string {
  // Already-clean labels skip the pipeline: nothing to trim, and over pure ASCII
  // lowercase is the final folded form expected by mdast identifiers.
  scan: {
    let hasUppercase = false;
    for (let index = 0; index < label.length; index++) {
      const code = label.charCodeAt(index);
      if (code === 32) {
        // Leading, trailing, or doubled spaces need the full pipeline.
        if (index === 0 || index + 1 === label.length || label.charCodeAt(index + 1) === 32) {
          break scan;
        }
        continue;
      }
      // Non-printable or non-ASCII characters need the full pipeline.
      if (code < 32 || code > 126) {
        break scan;
      }
      if (code >= 65 && code <= 90) {
        hasUppercase = true;
      }
    }
    return hasUppercase ? label.toLowerCase() : label;
  }
  return label.trim().replace(/[ \t\r\n]+/g, " ").toLowerCase().toUpperCase().toLowerCase();
}
