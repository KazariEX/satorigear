import { InlineKind } from "../../../constants/inline.ts";
import { inlineTokenText } from "../../../inline/tokens.ts";
import { normalizeAssociationLabel, semanticText } from "../../utils.ts";
import type { InlineBuildRule } from "../../../inline/profile.ts";

export const inlineBuilds: readonly InlineBuildRule[] = [
  {
    kind: "leaf",
    token: InlineKind.FootnoteReference,
    build(tokenIndex, sourceSpan, context) {
      const label = inlineTokenText(context.view.text, context.tokens, tokenIndex, 2, 1);
      return {
        type: "footnoteReference",
        identifier: normalizeAssociationLabel(label),
        label: semanticText(label),
        position: sourceSpan,
      };
    },
  },
];
