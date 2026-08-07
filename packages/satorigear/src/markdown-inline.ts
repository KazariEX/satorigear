import markdown from "./markdown.ts";
import type { CstGrammar } from "../../../vendors/monogram/src/types.ts";

const inlineTokens = new Set([
  "HtmlComment",
  "CodeSpan",
  "Image",
  "Link",
  "ReferenceLink",
  "Autolink",
  "InlineHtml",
  "Entity",
  "HardBreak",
  "Escape",
  "Strong",
  "Strikethrough",
  "Emphasis",
  "Text",
  "Delimiter",
  "Newline",
]);

const inlineRules = new Set(["Inline", "InlineLine", "InlineLines"]);

/**
 * Inline-only view of the Markdown grammar. Block tokens are absent, so line-start syntax remains
 * ordinary inline content after the block phase has assigned the region to a paragraph or heading.
 */
export const markdownInlineGrammar: CstGrammar = {
  ...markdown,
  name: "markdown-inline",
  tokens: markdown.tokens
    .filter((token) => inlineTokens.has(token.name))
    .map((token) => {
      if (token.name !== "CodeSpan") return token;
      return {
        ...token,
        delimitedSpan: token.delimitedSpan && { ...token.delimitedSpan, multiline: true },
      };
    }),
  rules: markdown.rules.filter((rule) => inlineRules.has(rule.name)),
  newline: {
    token: "Newline",
    hardBreak: { token: "HardBreak", minSpaces: 2 },
  },
};
