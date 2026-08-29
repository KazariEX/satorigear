import { Character } from "../../../constants/character.ts";
import { InlineKind } from "../../../constants/inline.ts";
import {
  appendInlineToken,
  inlineTokenEnd,
  inlineTokenKind,
  inlineTokenStart,
} from "../../../inline/tokens.ts";
import { componentNameEnd, normalizeComponentName } from "../attributes/syntax.ts";
import type { InlineNodeBuilder } from "../../../fragment/inline.ts";
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

export const inlineScans: readonly InlineScanRule[] = [
  {
    marker: Character.Colon,
    scan(source, start, tokens) {
      const end = canStartInlineColon(source, start)
        ? componentNameEnd(source, start + 1, false)
        : void 0;
      if (end === void 0) {
        return -1;
      }
      appendInlineToken(tokens, InlineKind.InlineComponent, start, end);
      return end;
    },
  },
];

// Pair openers include `[`, while leaf tokens end at the component name.
const buildInlineComponent: InlineNodeBuilder = (
  open,
  close,
  sourceSpan,
  children,
  context,
) => {
  const nameEnd = inlineTokenEnd(context.tokens, open) - (
    inlineTokenKind(context.tokens, open) === InlineKind.InlineComponentOpen ? 1 : 0
  );
  const name = normalizeComponentName(
    context.view.text.slice(
      inlineTokenStart(context.tokens, open) + 1,
      nameEnd,
    ),
  );
  return {
    type: "inlineComponent",
    name,
    attributes: {},
    children,
    position: sourceSpan,
  };
};

export const inlineBuilds: readonly InlineBuildRule[] = [
  {
    kind: "leaf",
    token: InlineKind.InlineComponent,
    build(token, sourceSpan, context) {
      return buildInlineComponent(token, token, sourceSpan, [], context);
    },
  },
  {
    kind: "pair",
    token: InlineKind.InlineComponentOpen,
    build: buildInlineComponent,
  },
  {
    kind: "pair",
    token: InlineKind.InlineSpanOpen,
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
