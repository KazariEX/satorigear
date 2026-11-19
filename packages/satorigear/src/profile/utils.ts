import { decodeString } from "micromark-util-decode-string";
import { Character } from "../constants/character.ts";

const inlineColonBoundary = /[ \t\n\r\p{sc=Han}\p{sc=Hira}\p{sc=Kana}\p{sc=Hang}\p{P}]/u;
const nonSpaceAndLineEnding = /[^ \r\n]/;

export function isAsciiDigit(code: number): boolean {
  return code >= Character.DigitZero && code <= Character.DigitNine;
}

export function isAsciiLetter(code: number): boolean {
  return (
    code >= Character.LatinCapitalLetterA && code <= Character.LatinCapitalLetterZ ||
    code >= Character.LatinSmallLetterA && code <= Character.LatinSmallLetterZ
  );
}

export function isAsciiPunctuation(code: number): boolean {
  return (
    code >= Character.ExclamationMark && code <= Character.Solidus ||
    code >= Character.Colon && code <= Character.CommercialAt ||
    code >= Character.LeftSquareBracket && code <= Character.GraveAccent ||
    code >= Character.LeftCurlyBracket && code <= Character.Tilde
  );
}

export function isAsciiWhitespace(code: number): boolean {
  return (
    code === Character.Space ||
    code >= Character.CharacterTabulation && code <= Character.CarriageReturn
  );
}

export function isSpaceOrLineEnding(code: number): boolean {
  return (
    code === Character.Space ||
    code === Character.LineFeed ||
    code === Character.CarriageReturn
  );
}

export function isSpaceTabOrLineEnding(code: number): boolean {
  return (
    code === Character.Space ||
    code === Character.LineFeed ||
    code === Character.CarriageReturn ||
    code === Character.CharacterTabulation
  );
}

export function hasInlineColonBoundary(source: string, start: number): boolean {
  if (start <= 0) {
    return true;
  }
  const previous = source[start - 1];
  return previous !== ":" && inlineColonBoundary.test(previous);
}

export function hasInlinePadding(value: string): boolean {
  return (
    isSpaceOrLineEnding(value.charCodeAt(0)) &&
    isSpaceOrLineEnding(value.charCodeAt(value.length - 1)) &&
    nonSpaceAndLineEnding.test(value)
  );
}

export function semanticText(value: string): string {
  return value.includes("\\") || value.includes("&") ? decodeString(value) : value;
}

const identifierNeedsCleanup = /[^\x20-\x7E]|^ | $| {2}/;
const identifierWhitespace = /[ \t\r\n]+/g;

/**
 * Fast replacement of [`micromark-util-normalize-identifier`](
 *   https://github.com/micromark/micromark/tree/main/packages/micromark-util-normalize-identifier
 * ).
 */
export function normalizeIdentifier(identifier: string): string {
  // Printable ASCII with single interior spaces needs only lowercase folding.
  return identifierNeedsCleanup.test(identifier)
    ? identifier.trim().replace(identifierWhitespace, " ").toLowerCase().toUpperCase().toLowerCase()
    : identifier.toLowerCase();
}
