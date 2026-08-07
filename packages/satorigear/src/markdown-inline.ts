import markdown from "./markdown.ts";
import type { CstGrammar, RuleExpr } from "../../../vendors/monogram/src/types.ts";

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

function candidateReferences(expression: RuleExpr): RuleExpr {
  switch (expression.type) {
    case "ref": return expression.name === "ReferenceLink" ? { ...expression, name: "ReferenceCandidate" } : expression;
    case "seq": case "alt": return { ...expression, items: expression.items.map(candidateReferences) };
    case "quantifier": case "not": return { ...expression, body: candidateReferences(expression.body) };
    case "group": return {
      ...expression,
      body: candidateReferences(expression.body),
      ...(expression.tsRelaxed ? { tsRelaxed: candidateReferences(expression.tsRelaxed) } : {}),
    };
    case "sep": return { ...expression, element: candidateReferences(expression.element) };
    default: return expression;
  }
}

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
      if (token.name === "ReferenceLink") return { ...token, name: "ReferenceCandidate" };
      if (token.name !== "CodeSpan") return token;
      return {
        ...token,
        delimitedSpan: token.delimitedSpan && { ...token.delimitedSpan, multiline: true },
      };
    }),
  rules: markdown.rules
    .filter((rule) => inlineRules.has(rule.name))
    .map((rule) => ({ ...rule, body: candidateReferences(rule.body) })),
  newline: {
    token: "Newline",
    hardBreak: { token: "HardBreak", minSpaces: 2 },
  },
};
