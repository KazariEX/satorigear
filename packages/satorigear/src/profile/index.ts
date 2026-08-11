import { type BlockFeature, compileBlockProfile } from "../block/profile.ts";
import { compileInlineProfile, type InlineFeature } from "../inline/profile.ts";
import { feature as featureAttributes } from "./features/attributes/index.ts";
import { feature as featureBlockQuote } from "./features/blockquote.ts";
import { feature as featureBreak } from "./features/break.ts";
import { feature as featureCode } from "./features/code.ts";
import { feature as featureComponent } from "./features/component/index.ts";
import { feature as featureFootnote } from "./features/footnote/index.ts";
import { feature as featureFormatting, type StrikethroughOptions } from "./features/formatting.ts";
import { feature as frontmatterFeature, type FrontmatterOptions } from "./features/frontmatter.ts";
import { feature as featureHeading } from "./features/heading.ts";
import { feature as featureHtml } from "./features/html.ts";
import { feature as featureLink } from "./features/link.ts";
import { feature as featureList } from "./features/list.ts";
import { feature as featureMath } from "./features/math/index.ts";
import { feature as featureParagraph } from "./features/paragraph.ts";
import { feature as featureReference } from "./features/reference.ts";
import { feature as featureTable } from "./features/table.ts";
import { feature as featureText, semanticText } from "./features/text.ts";
import type { MathOptions } from "./features/math/types.ts";
import type { SyntaxProfile } from "./types.ts";

export interface SyntaxOptions {
  attributes?: boolean;
  component?: boolean;
  footnote?: boolean;
  frontmatter?: boolean | FrontmatterOptions;
  math?: boolean | MathOptions;
  strikethrough?: boolean | StrikethroughOptions;
  table?: boolean;
}

// Compilation builds the hot dispatch tables once; documents only retain the immutable result.
export function compileProfile(options: SyntaxOptions = {}): SyntaxProfile {
  const features = [
    featureHeading,
    featureBreak,
    featureBlockQuote,
    featureList,
    featureCode,
    featureHtml,
  ];

  if (options.footnote) {
    features.push(featureFootnote);
  }

  features.push(featureReference);

  if (options.frontmatter) {
    features.unshift(
      frontmatterFeature(
        typeof options.frontmatter === "object"
          ? options.frontmatter.marker
          : "-",
      ),
    );
  }
  if (options.table) {
    // A delimiter promotes the preceding paragraph line, so tables must run before the paragraph fallback.
    features.push(featureTable);
  }
  if (options.math) {
    features.push(featureMath(options.math));
  }

  features.push(
    featureParagraph,
    featureText,
    featureFormatting(options.strikethrough),
    featureLink,
  );

  if (options.component) {
    features.push(featureComponent);
  }
  if (options.attributes) {
    features.push(featureAttributes);
  }

  const blockFeatures: BlockFeature[] = [];
  const inlineFeatures: InlineFeature[] = [];
  for (const feature of features) {
    if (feature.block) {
      blockFeatures.push(feature.block);
    }
    if (feature.inline) {
      inlineFeatures.push(feature.inline);
    }
  }

  return {
    block: compileBlockProfile(blockFeatures),
    inline: compileInlineProfile(inlineFeatures, semanticText),
  };
}
