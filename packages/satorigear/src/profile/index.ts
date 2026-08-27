import { type BlockFeature, compileBlockProfile } from "../block/profile.ts";
import { compileInlineProfile, type InlineFeature } from "../inline/profile.ts";
import { feature as featureAttributes } from "./features/attributes/index.ts";
import { feature as featureBinding } from "./features/binding.ts";
import { feature as featureBlockQuote } from "./features/blockquote.ts";
import { feature as featureBreak } from "./features/break.ts";
import { feature as featureCode } from "./features/code.ts";
import { feature as featureComponent } from "./features/component/index.ts";
import { feature as featureEmoji } from "./features/emoji/index.ts";
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
import { feature as featureText } from "./features/text.ts";
import { compileInlineResolver } from "./resolve.ts";
import type { MathOptions } from "./features/math/types.ts";
import type { SyntaxProfile } from "./types.ts";

export interface FeatureOptions {
  attributes?: boolean;
  binding?: boolean;
  component?: boolean;
  emoji?: boolean;
  footnote?: boolean;
  frontmatter?: boolean | FrontmatterOptions;
  math?: boolean | MathOptions;
  strikethrough?: boolean | StrikethroughOptions;
  table?: boolean;
  taskList?: boolean;
}

// Compilation builds the hot dispatch tables once; documents only retain the immutable result.
export function compileProfile(options: FeatureOptions = {}): SyntaxProfile {
  const features = [
    featureHeading,
    featureBreak,
    featureBlockQuote,
    featureList(options.taskList),
    featureCode,
    featureHtml,
  ];

  if (options.footnote) {
    features.push(featureFootnote);
  }

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

  if (options.attributes) {
    features.push(featureAttributes);
  }
  if (options.binding) {
    features.push(featureBinding);
  }
  if (options.emoji) {
    // A closed shortcode must win over the component prefix that shares its opening colon.
    features.push(featureEmoji);
  }
  if (options.component) {
    features.push(featureComponent);
  }

  // Register generic link definitions after feature-specific `[` definitions such as footnotes.
  features.push(featureReference);

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
    inline: compileInlineProfile(
      inlineFeatures,
      compileInlineResolver({
        component: options.component === true,
        footnote: options.footnote === true,
      }),
    ),
  };
}
