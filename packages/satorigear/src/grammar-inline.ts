import { altPattern, anyChar, end, followedBy, noneOf, notFollowedBy, oneOf, optPattern, plus, range, repeat, seq, star } from "monogram/api.ts";
import type { DelimiterRunConfig, PairedTokenConfig } from "monogram/delimiter-parser.ts";
import type { Token } from "monogram/gen-lexer.ts";
import type { CstGrammar, RuleDecl, RuleExpr, TokenDecl } from "monogram/types.ts";
import markdown from "./grammar.ts";

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
const delimiterRule = (name: string, open: string, close: string, content = "Inline"): RuleDecl => ({
  name,
  flags: [],
  body: {
    type: "seq",
    items: [
      ruleReference(open),
      {
        type: "quantifier",
        kind: "+",
        body: { type: "alt", items: [ruleReference(content), ruleReference("Newline")] },
      },
      ruleReference(close),
    ],
  },
});
const bracketRule = (name: string, open: string, close: string, content = "Inline"): RuleDecl => ({
  name,
  flags: [],
  body: {
    type: "seq",
    items: [
      ruleReference(open),
      {
        type: "quantifier",
        kind: "*",
        body: {
          type: "seq",
          items: [{ type: "not", body: ruleReference(close) }, ruleReference(content)],
        },
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
const escapedInlineCharacter = seq("\\", anyChar());
const linkWhitespace = oneOf(" ", "\t", "\n", "\r");
const bareDestination = (depth: number): ReturnType<typeof altPattern> => {
  const ordinary = altPattern(escapedInlineCharacter, noneOf(" ", "\t", "\n", "\r", "(", ")", "\\"));
  return depth === 0
    ? ordinary
    : altPattern(ordinary, seq("(", star(bareDestination(depth - 1)), ")"));
};
const linkDestination = altPattern(
  seq("<", star(altPattern(escapedInlineCharacter, noneOf("<", ">", "\n", "\r", "\\"))), ">"),
  seq(notFollowedBy("<"), plus(bareDestination(32))),
);
const linkTitle = altPattern(
  seq("\"", star(altPattern(escapedInlineCharacter, noneOf("\"", "\n", "\r", "\\"))), "\""),
  seq("'", star(altPattern(escapedInlineCharacter, noneOf("'", "\n", "\r", "\\"))), "'"),
  seq("(", star(altPattern(escapedInlineCharacter, noneOf(")", "\n", "\r", "\\"))), ")"),
);
const linkTailPattern = seq(
  "](",
  star(linkWhitespace),
  optPattern(seq(linkDestination, optPattern(seq(plus(linkWhitespace), linkTitle)))),
  star(linkWhitespace),
  ")",
);
const referenceLabelCharacter = altPattern(escapedInlineCharacter, noneOf("[", "]", "\\"));
const referenceLabelNonWhitespace = altPattern(
  escapedInlineCharacter,
  noneOf("[", "]", " ", "\t", "\n", "\r", "\\"),
);
const referenceLabel = altPattern(
  "",
  seq(
    followedBy(seq(repeat(oneOf(" ", "\t", "\n", "\r"), 0, 998), referenceLabelNonWhitespace)),
    repeat(referenceLabelCharacter, 1, 999),
  ),
);
const referenceTailPattern = seq("]", "[", referenceLabel, "]");
const physicalLineEnd = altPattern("\r\n", "\r", "\n", end());
const inlineTextPattern = plus(altPattern(
  noneOf("\n", "\r", "\\", "`", "*", "_", "[", "]", "<", "!", "&", "~", " "),
  seq("\\", oneOf(" ", "\t")),
  seq(" ", notFollowedBy(seq(" ", star(" "), physicalLineEnd))),
));

function bracketFallbacks(rule: RuleDecl): RuleDecl {
  if (rule.name !== "Inline" || rule.body.type !== "alt") {
    return rule;
  }
  return {
    ...rule,
    body: {
      ...rule.body,
      items: rule.body.items.concat([
        ruleReference("ReferenceImage"),
        ruleReference("BracketFallback"),
      ]),
    },
  };
}

function linkContentReferences(expression: RuleExpr): RuleExpr {
  if (expression.type === "alt") {
    return {
      ...expression,
      items: expression.items
        .filter((item) => item.type !== "ref"
          || (item.name !== "Link" && item.name !== "ReferenceLink" && item.name !== "Autolink"))
        .map(linkContentReferences),
    };
  }
  if (expression.type === "ref") {
    const variants: Record<string, string> = {
      Emphasis: "LinkEmphasis",
      Strong: "LinkStrong",
      Image: "LinkImage",
      ReferenceImage: "LinkReferenceImage",
    };
    return variants[expression.name] ? { ...expression, name: variants[expression.name] } : expression;
  }
  if (expression.type === "seq") {
    return { ...expression, items: expression.items.map(linkContentReferences) };
  }
  if (expression.type === "quantifier" || expression.type === "not") {
    return { ...expression, body: linkContentReferences(expression.body) };
  }
  if (expression.type === "group") {
    return {
      ...expression,
      body: linkContentReferences(expression.body),
      ...(expression.tsRelaxed ? { tsRelaxed: linkContentReferences(expression.tsRelaxed) } : {}),
    };
  }
  if (expression.type === "sep") {
    return { ...expression, element: linkContentReferences(expression.element) };
  }
  return expression;
}

const baseInlineRules = markdown.rules
  .filter((rule) => inlineRules.has(rule.name))
  .map((rule) => bracketFallbacks(rule));
const linkContentBody = linkContentReferences(baseInlineRules.find((rule) => rule.name === "Inline")!.body);

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
      if (["Emphasis", "Strong", "Image", "Link", "ReferenceLink"].includes(token.name)) {
        return [];
      }
      if (token.name === "Autolink") {
        return { ...token, pattern: autolinkPattern };
      }
      if (token.name === "InlineHtml") {
        return { ...token, pattern: inlineHtmlPattern };
      }
      if (token.name === "Text") {
        return { ...token, pattern: inlineTextPattern };
      }
      if (token.name === "HtmlComment") {
        return {
          ...token,
          pattern: altPattern("<!-->", "<!--->", token.pattern),
        };
      }
      if (token.name !== "CodeSpan") {
        return token;
      }
      return {
        ...token,
        delimitedSpan: token.delimitedSpan && { ...token.delimitedSpan, multiline: true },
      };
    })
    .flatMap((token) => {
      if (token.name !== "Delimiter") {
        return [token];
      }
      return [
        engineToken("AsteriskRun", plus("*")),
        engineToken("UnderscoreRun", plus("_")),
        engineToken("EmphasisOpen"),
        engineToken("EmphasisClose"),
        engineToken("StrongOpen"),
        engineToken("StrongClose"),
        engineToken("ImageOpen", "!["),
        engineToken("BracketOpen", "["),
        engineToken("LinkTail", linkTailPattern),
        engineToken("ReferenceTail", referenceTailPattern),
        engineToken("ShortcutReferenceTail", "]"),
        engineToken("ReferenceSeparatorClose"),
        engineToken("LinkOpen"),
        engineToken("LinkClose"),
        engineToken("ImageLinkOpen"),
        engineToken("ImageLinkClose"),
        engineToken("ReferenceOpen"),
        engineToken("ReferenceClose"),
        engineToken("ImageReferenceOpen"),
        engineToken("ImageReferenceClose"),
        token,
      ];
    }),
  rules: baseInlineRules.concat([
    delimiterRule("Emphasis", "EmphasisOpen", "EmphasisClose"),
    delimiterRule("Strong", "StrongOpen", "StrongClose"),
    delimiterRule("LinkEmphasis", "EmphasisOpen", "EmphasisClose", "LinkContent"),
    delimiterRule("LinkStrong", "StrongOpen", "StrongClose", "LinkContent"),
    bracketRule("Image", "ImageLinkOpen", "ImageLinkClose"),
    bracketRule("Link", "LinkOpen", "LinkClose", "LinkContent"),
    bracketRule("ReferenceLink", "ReferenceOpen", "ReferenceClose"),
    bracketRule("ReferenceImage", "ImageReferenceOpen", "ImageReferenceClose"),
    bracketRule("LinkImage", "ImageLinkOpen", "ImageLinkClose", "LinkContent"),
    bracketRule("LinkReferenceImage", "ImageReferenceOpen", "ImageReferenceClose", "LinkContent"),
    { name: "LinkContent", flags: [], body: linkContentBody },
    {
      name: "BracketFallback",
      flags: [],
      body: {
        type: "alt",
        items: [
          "ImageOpen",
          "BracketOpen",
          "LinkTail",
          "ReferenceTail",
          "ShortcutReferenceTail",
          "ReferenceSeparatorClose",
          "LinkOpen",
          "LinkClose",
          "ImageLinkOpen",
          "ImageLinkClose",
          "ReferenceOpen",
          "ReferenceClose",
          "ImageReferenceOpen",
          "ImageReferenceClose",
        ].map(ruleReference),
      },
    },
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

export function normalizeMarkdownReferenceLabel(label: string): string {
  return label.trim().replace(/[ \t\r\n]+/g, " ").toLowerCase().toUpperCase();
}

function tokenFragment(token: Token, type: string, text: string, offset: number, first = false): Token {
  return {
    ...token,
    type,
    text,
    offset,
    k: 0,
    t: 0,
    newlineBefore: first && token.newlineBefore,
    commentBefore: first && token.commentBefore,
    multilineFlowBefore: first && token.multilineFlowBefore,
  };
}

function splitReferenceTail(token: Token): Token[] {
  const label = token.text.slice(2, -1);
  return [
    tokenFragment(token, "ReferenceSeparatorClose", "]", token.offset, true),
    tokenFragment(token, "BracketOpen", "[", token.offset + 1),
    ...(label ? [tokenFragment(token, "Text", label, token.offset + 2)] : []),
    tokenFragment(token, "ShortcutReferenceTail", "]", token.offset + token.text.length - 1),
  ];
}

/**
 * Recover the one-token overlap between adjacent full-reference candidates. A lexer cannot emit
 * both `][bar]` and the overlapping `][baz]` from `[foo][bar][baz]`; when `bar` is undefined but
 * `baz` is defined, split the former and promote the latter before the generic pair resolver runs.
 */
export function reassociateMarkdownReferenceTails(
  source: string,
  tokens: readonly Token[],
  referenceLabels: ReadonlySet<string>,
): Token[] {
  const result: Token[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const tail = tokens[index];
    const label = tail.type === "ReferenceTail" ? tail.text.slice(2, -1) : "";
    if (tail.type !== "ReferenceTail" || referenceLabels.has(normalizeMarkdownReferenceLabel(label))) {
      result.push(tail);
      continue;
    }
    const opener = tokens[index + 1];
    if (opener?.type !== "BracketOpen" || opener.offset !== tail.offset + tail.text.length) {
      result.push(tail);
      continue;
    }
    let closerIndex = index + 2;
    while (closerIndex < tokens.length && tokens[closerIndex].type !== "ShortcutReferenceTail") {
      closerIndex++;
    }
    const closer = tokens[closerIndex];
    if (!closer || tokens.slice(index + 2, closerIndex).some((token) => token.type === "BracketOpen" || token.type === "ImageOpen")) {
      result.push(tail);
      continue;
    }
    const nextLabel = source.slice(opener.offset + opener.text.length, closer.offset);
    if (!referenceLabels.has(normalizeMarkdownReferenceLabel(nextLabel))) {
      result.push(tail);
      continue;
    }
    result.push(...splitReferenceTail(tail).slice(0, -1));
    const offset = tail.offset + tail.text.length - 1;
    result.push(tokenFragment(tail, "ReferenceTail", source.slice(offset, closer.offset + closer.text.length), offset));
    index = closerIndex;
  }
  return result;
}

export function markdownBracketPairs(
  referenceLabels: ReadonlySet<string>,
  candidateLabels?: Set<string>,
): PairedTokenConfig[] {
  const activatesReference = ({ closer, content }: { closer: { text: string }; content: string }): boolean => {
    const explicit = closer.text.startsWith("][") ? closer.text.slice(2, -1) : "";
    const label = normalizeMarkdownReferenceLabel(explicit || content);
    candidateLabels?.add(label);
    return referenceLabels.has(label);
  };
  return [
    {
      opener: "BracketOpen",
      closer: "LinkTail",
      open: "LinkOpen",
      close: "LinkClose",
      deactivateEarlier: ["BracketOpen"],
      isolateDelimiters: true,
    },
    {
      opener: "ImageOpen",
      closer: "LinkTail",
      open: "ImageLinkOpen",
      close: "ImageLinkClose",
    },
    {
      opener: "BracketOpen",
      closer: "ReferenceTail",
      open: "ReferenceOpen",
      close: "ReferenceClose",
      deactivateEarlier: ["BracketOpen"],
      isolateDelimiters: true,
      activate: activatesReference,
      splitUnmatchedCloser: splitReferenceTail,
    },
    {
      opener: "BracketOpen",
      closer: "ShortcutReferenceTail",
      open: "ReferenceOpen",
      close: "ReferenceClose",
      deactivateEarlier: ["BracketOpen"],
      isolateDelimiters: true,
      activate: activatesReference,
      content: {
        requireNonWhitespace: true,
        maxCharacters: 999,
        forbidTokens: ["BracketOpen", "ImageOpen"],
      },
    },
    {
      opener: "ImageOpen",
      closer: "ReferenceTail",
      open: "ImageReferenceOpen",
      close: "ImageReferenceClose",
      isolateDelimiters: true,
      activate: activatesReference,
      splitUnmatchedCloser: splitReferenceTail,
    },
    {
      opener: "ImageOpen",
      closer: "ShortcutReferenceTail",
      open: "ImageReferenceOpen",
      close: "ImageReferenceClose",
      isolateDelimiters: true,
      activate: activatesReference,
      content: {
        requireNonWhitespace: true,
        maxCharacters: 999,
        forbidTokens: ["BracketOpen", "ImageOpen"],
      },
    },
  ];
}
