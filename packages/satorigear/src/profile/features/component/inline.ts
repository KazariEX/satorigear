import { Character } from "../../../constants/character.ts";
import { InlineKind } from "../../../constants/inline.ts";
import {
  appendInlineToken,
  inlineTokenEnd,
  inlineTokenStart,
} from "../../../inline/tokens.ts";
import {
  componentNameEnd,
  normalizeComponentName,
} from "../attributes/syntax.ts";
import type { InlineScanRule } from "../../../inline/lexer.ts";
import type { InlineBuildRule } from "../../../inline/profile.ts";

const allowedPrevious = /[ \t\n\r\p{sc=Han}\p{sc=Hira}\p{sc=Kana}\p{sc=Hang}\p{P}]/u;

/** Whether a colon has the left boundary required by an inline component. */
export function canStartInlineColon(source: string, start: number): boolean {
  if (start <= 0) {
    return true;
  }
  const previous = source[start - 1];
  return previous !== ":" && allowedPrevious.test(previous);
}

function inlineComponentEnd(source: string, start: number): number | undefined {
  if (canStartInlineColon(source, start)) {
    return componentNameEnd(source, start + 1, false);
  }
}

export const inlineScans: readonly InlineScanRule[] = [
  {
    marker: Character.Colon,
    scan(source, start, tokens) {
      const end = inlineComponentEnd(source, start);
      if (end === void 0) {
        return -1;
      }
      appendInlineToken(tokens, InlineKind.InlineComponentOpen, start, end);
      return end;
    },
  },
];

export const inlineBuilds: readonly InlineBuildRule[] = [
  {
    kind: "container",
    token: InlineKind.InlineComponentOpen,
    contentOpen: InlineKind.InlineComponentLabelOpen,
    close: InlineKind.InlineComponentLabelClose,
    build(open, close, sourceSpan, children, context) {
      const text = context.view.text.slice(
        inlineTokenStart(context.tokens, open) + 1,
        inlineTokenEnd(context.tokens, open),
      );
      return {
        type: "inlineComponent",
        name: normalizeComponentName(text),
        attributes: {},
        children,
        position: sourceSpan,
      };
    },
  },
  {
    kind: "pair",
    open: InlineKind.InlineSpanOpen,
    close: InlineKind.InlineSpanClose,
    build(open, close, sourceSpan, children) {
      return {
        type: "inlineComponent",
        name: "span",
        attributes: {},
        children,
        position: sourceSpan,
      };
    },
  },
];
