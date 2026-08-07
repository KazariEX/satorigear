import { altPattern, anyChar, followedBy, noneOf, oneOf, optPattern, plus, range, repeat, seq, star } from "../../../vendors/monogram/src/api.ts";
import markdown from "./markdown.ts";
import type { DelimiterRunConfig } from "../../../vendors/monogram/src/delimiter-parser.ts";
import type { CstGrammar, RuleDecl, RuleExpr, TokenDecl } from "../../../vendors/monogram/src/types.ts";

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
const engineToken = (name: string, pattern: TokenDecl["pattern"] = { type: "never" }): TokenDecl => ({ name, pattern, flags: [] });
const ruleReference = (name: string): RuleExpr => ({ type: "ref", name });
const delimiterRule = (name: string, open: string, close: string): RuleDecl => ({
  name,
  flags: [],
  body: {
    type: "seq",
    items: [
      ruleReference(open),
      {
        type: "quantifier",
        kind: "+",
        body: { type: "alt", items: [ruleReference("Inline"), ruleReference("Newline")] },
      },
      ruleReference(close),
    ],
  },
});
const asciiLetter = oneOf(range("A", "Z"), range("a", "z"));
const asciiAlphanumeric = oneOf(asciiLetter, range("0", "9"));
const schemeCharacter = oneOf(asciiAlphanumeric, "+", ".", "-");
const emailLocalCharacter = oneOf(
  asciiAlphanumeric,
  "!",
  "#",
  "$",
  "%",
  "&",
  "'",
  "*",
  "+",
  "-",
  "/",
  "=",
  "?",
  "^",
  "_",
  "`",
  "{",
  "|",
  "}",
  "~",
  ".",
);
const emailDomainLabel = seq(
  asciiAlphanumeric,
  star(altPattern(asciiAlphanumeric, seq("-", followedBy(asciiAlphanumeric)))),
);
const autolinkPattern = seq("<", altPattern(
  seq(asciiLetter, repeat(schemeCharacter, 1, 31), ":", plus(noneOf(" ", "\t", "\n", "\r", "<", ">"))),
  seq(plus(emailLocalCharacter), "@", emailDomainLabel, plus(seq(".", emailDomainLabel))),
), ">");

const inlineWhitespace = oneOf(" ", "\t", "\n", "\r");
const htmlName = seq(asciiLetter, star(oneOf(asciiAlphanumeric, "-")));
const htmlAttributeName = seq(
  oneOf(asciiLetter, "_", ":"),
  star(oneOf(asciiAlphanumeric, "_", ".", ":", "-")),
);
const htmlAttributeValue = altPattern(
  plus(noneOf(" ", "\t", "\n", "\r", "\"", "'", "=", "<", ">", "`")),
  seq("'", star(noneOf("'")), "'"),
  seq("\"", star(noneOf("\"")), "\""),
);
const htmlAttribute = seq(
  plus(inlineWhitespace),
  htmlAttributeName,
  optPattern(seq(star(inlineWhitespace), "=", star(inlineWhitespace), htmlAttributeValue)),
);
const inlineHtmlPattern = altPattern(
  seq("<", htmlName, star(htmlAttribute), star(inlineWhitespace), optPattern("/"), ">"),
  seq("</", htmlName, star(inlineWhitespace), ">"),
  seq("<?", star(anyChar(), { greedy: false }), "?>"),
  seq("<!", oneOf(range("A", "Z")), star(anyChar(), { greedy: false }), ">"),
  seq("<![CDATA[", star(anyChar(), { greedy: false }), "]]>"),
);

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
    .flatMap((token) => {
      if (token.name === "Emphasis" || token.name === "Strong") return [];
      if (token.name === "ReferenceLink") return { ...token, name: "ReferenceCandidate" };
      if (token.name === "Autolink") return { ...token, pattern: autolinkPattern };
      if (token.name === "InlineHtml") return { ...token, pattern: inlineHtmlPattern };
      if (token.name === "HtmlComment") {
        return {
          ...token,
          pattern: altPattern("<!-->", "<!--->", token.pattern),
        };
      }
      if (token.name !== "CodeSpan") return token;
      return {
        ...token,
        delimitedSpan: token.delimitedSpan && { ...token.delimitedSpan, multiline: true },
      };
    })
    .flatMap((token) => {
      if (token.name !== "Delimiter") return [token];
      return [
        engineToken("AsteriskRun", plus("*")),
        engineToken("UnderscoreRun", plus("_")),
        engineToken("EmphasisOpen"),
        engineToken("EmphasisClose"),
        engineToken("StrongOpen"),
        engineToken("StrongClose"),
        token,
      ];
    }),
  rules: markdown.rules
    .filter((rule) => inlineRules.has(rule.name))
    .map((rule) => ({ ...rule, body: candidateReferences(rule.body) }))
    .concat([
      delimiterRule("Emphasis", "EmphasisOpen", "EmphasisClose"),
      delimiterRule("Strong", "StrongOpen", "StrongClose"),
    ]),
  newline: {
    token: "Newline",
    hardBreak: { token: "HardBreak", minSpaces: 2 },
  },
};

export const markdownDelimiterRuns: DelimiterRunConfig[] = [
  {
    token: "AsteriskRun",
    marker: "*",
    fallbackToken: "Delimiter",
    single: { open: "EmphasisOpen", close: "EmphasisClose" },
    double: { open: "StrongOpen", close: "StrongClose" },
    ruleOfThree: true,
  },
  {
    token: "UnderscoreRun",
    marker: "_",
    fallbackToken: "Delimiter",
    single: { open: "EmphasisOpen", close: "EmphasisClose" },
    double: { open: "StrongOpen", close: "StrongClose" },
    intraword: false,
    ruleOfThree: true,
  },
];
