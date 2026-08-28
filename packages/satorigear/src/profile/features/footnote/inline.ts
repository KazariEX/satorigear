import { InlineKind } from "../../../constants/inline.ts";
import { inlineTokenText } from "../../../inline/tokens.ts";
import { normalizeAssociationLabel } from "../../utils.ts";
import { semanticText } from "../text.ts";
import type { InlineBuildRule } from "../../../inline/profile.ts";

export const inlineBuilds: readonly InlineBuildRule[] = [
  {
    kind: "leaf",
    token: InlineKind.FootnoteReference,
    build(tokenIndex, sourceSpan, context) {
      const source = inlineTokenText(context.view.text, context.tokens, tokenIndex);
      const label = source.slice(2, -1);
      return {
        type: "footnoteReference",
        identifier: normalizeAssociationLabel(label),
        label: semanticText(label),
        position: sourceSpan,
      };
    },
  },
];
