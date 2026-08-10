import {
  alt,
  altPattern,
  anyChar,
  defineGrammar,
  end,
  followedBy,
  many,
  many1,
  never,
  noneOf,
  not,
  notFollowedBy,
  oneOf,
  optPattern,
  plus,
  range,
  repeat,
  rule,
  type RuleRef,
  seq,
  star,
  token,
} from "monogram/api.ts";

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

const HtmlComment = token(altPattern(
  "<!-->",
  "<!--->",
  seq("<!--", star(anyChar(), { greedy: false }), altPattern("-->", end())),
), { scope: "comment.block.html" });
const CodeSpan = token(altPattern(
  seq("```", plus(noneOf("\n", "\r"), { greedy: false }), "```"),
  seq("``", plus(noneOf("\n", "\r"), { greedy: false }), "``"),
  seq("`", plus(noneOf("`", "\n", "\r")), "`"),
), {
  scope: "markup.raw.inline",
  delimitedSpan: { markers: ["`"], minLength: 1, multiline: true },
});
const MathText = token(never());
const Autolink = token(autolinkPattern, { scope: "markup.underline.link" });
const InlineHtml = token(inlineHtmlPattern, { scope: "meta.tag.inline.html" });
const Entity = token(seq("&", altPattern(
  seq("#", oneOf("x", "X"), repeat(oneOf(range("0", "9"), range("A", "F"), range("a", "f")), 1, 6)),
  seq("#", repeat(range("0", "9"), 1, 7)),
  seq(asciiLetter, repeat(asciiAlphanumeric, 0, 30)),
), ";"), { scope: "constant.character.entity" });
const HardBreak = token(altPattern(
  seq("\\", followedBy(altPattern("\r", "\n"))),
  seq("  ", star(" "), followedBy(altPattern("\r", "\n"))),
), { scope: "punctuation.definition.hard-break" });
const Escape = token(seq("\\", oneOf(
  "!",
  "\"",
  "#",
  "$",
  "%",
  "&",
  "'",
  "(",
  ")",
  "*",
  "+",
  ",",
  "-",
  ".",
  "/",
  ":",
  ";",
  "<",
  "=",
  ">",
  "?",
  "@",
  "[",
  "\\",
  "]",
  "^",
  "_",
  "`",
  "{",
  "|",
  "}",
  "~",
)), { scope: "constant.character.escape" });
const Strikethrough = token(seq("~~", plus(noneOf("\n", "\r"), { greedy: false }), "~~"), {
  scope: "markup.strikethrough",
});
const Text = token(inlineTextPattern, { scope: "meta.paragraph" });

const AsteriskRun = token(plus("*"));
const UnderscoreRun = token(plus("_"));
const EmphasisOpen = token(never());
const EmphasisClose = token(never());
const StrongOpen = token(never());
const StrongClose = token(never());
const ImageOpen = token("![");
const BracketOpen = token("[");
const LinkTail = token(linkTailPattern);
const ReferenceTail = token(referenceTailPattern);
const ShortcutReferenceTail = token("]");
const ReferenceSeparatorClose = token(never());
const LinkOpen = token(never());
const LinkClose = token(never());
const ImageLinkOpen = token(never());
const ImageLinkClose = token(never());
const ReferenceOpen = token(never());
const ReferenceClose = token(never());
const ImageReferenceOpen = token(never());
const ImageReferenceClose = token(never());
const InlineComponentOpen = token(never());
const InlineComponentLabelOpen = token(never());
const InlineComponentLabelClose = token(never());
const Attributes = token(never());
const InlineSpanOpen = token(never());
const InlineSpanClose = token(never());
const Delimiter = token(oneOf("\\", "`", "*", "_", "[", "]", "<", ">", "!", "&", "~"), {
  scope: "punctuation.definition.markdown",
});
const Newline = token(never());
// A zero-width structural token keeps batched regions independent without changing their spans.
const InlineBoundary = token(never());

let Inline: RuleRef;
let LinkContent: RuleRef;

const InlineLine = rule(() => [[many1(Inline)]]);
const InlineLines = rule(($) => [InlineLine, [$, Newline, InlineLine]]);
const InlineForest = rule(() => [[InlineLines, many(InlineBoundary, InlineLines)]]);
const Emphasis = rule(() => [[EmphasisOpen, many1(alt(Inline, Newline)), EmphasisClose]]);
const Strong = rule(() => [[StrongOpen, many1(alt(Inline, Newline)), StrongClose]]);
const LinkEmphasis = rule(() => [[EmphasisOpen, many1(alt(LinkContent, Newline)), EmphasisClose]]);
const LinkStrong = rule(() => [[StrongOpen, many1(alt(LinkContent, Newline)), StrongClose]]);
const Image = rule(() => [[ImageLinkOpen, many(not(ImageLinkClose), Inline), ImageLinkClose]]);
const Link = rule(() => [[LinkOpen, many(not(LinkClose), LinkContent), LinkClose]]);
const ReferenceLink = rule(() => [[ReferenceOpen, many(not(ReferenceClose), Inline), ReferenceClose]]);
const ReferenceImage = rule(() => [[ImageReferenceOpen, many(not(ImageReferenceClose), Inline), ImageReferenceClose]]);
const LinkImage = rule(() => [[ImageLinkOpen, many(not(ImageLinkClose), LinkContent), ImageLinkClose]]);
const LinkReferenceImage = rule(() => [[
  ImageReferenceOpen,
  many(not(ImageReferenceClose), LinkContent),
  ImageReferenceClose,
]]);
const InlineComponent = rule(() => [
  [InlineComponentOpen],
  [
    InlineComponentOpen,
    InlineComponentLabelOpen,
    many(alt(Inline, Newline)),
    InlineComponentLabelClose,
  ],
]);
const InlineSpan = rule(() => [[
  InlineSpanOpen,
  many(alt(Inline, Newline)),
  InlineSpanClose,
]]);
const LinkComponent = rule(() => [
  [InlineComponentOpen],
  [
    InlineComponentOpen,
    InlineComponentLabelOpen,
    many(alt(LinkContent, Newline)),
    InlineComponentLabelClose,
  ],
]);
const LinkSpan = rule(() => [[
  InlineSpanOpen,
  many(alt(LinkContent, Newline)),
  InlineSpanClose,
]]);
const BracketFallback = rule(() => [
  ImageOpen,
  BracketOpen,
  LinkTail,
  ReferenceTail,
  ShortcutReferenceTail,
  ReferenceSeparatorClose,
  LinkOpen,
  LinkClose,
  ImageLinkOpen,
  ImageLinkClose,
  ReferenceOpen,
  ReferenceClose,
  ImageReferenceOpen,
  ImageReferenceClose,
]);

Inline = rule(() => [
  HtmlComment,
  CodeSpan,
  MathText,
  Image,
  Link,
  ReferenceLink,
  InlineComponent,
  InlineSpan,
  Autolink,
  InlineHtml,
  Entity,
  HardBreak,
  Escape,
  Strong,
  Strikethrough,
  Emphasis,
  Attributes,
  Text,
  Delimiter,
  ReferenceImage,
  BracketFallback,
]);
LinkContent = rule(() => [
  HtmlComment,
  CodeSpan,
  MathText,
  LinkImage,
  LinkComponent,
  LinkSpan,
  InlineHtml,
  Entity,
  HardBreak,
  Escape,
  LinkStrong,
  Strikethrough,
  LinkEmphasis,
  Attributes,
  Text,
  Delimiter,
  LinkReferenceImage,
  BracketFallback,
]);

export const grammar = defineGrammar({
  name: "markdown-inline",
  tokens: {
    HtmlComment,
    CodeSpan,
    MathText,
    Autolink,
    InlineHtml,
    Entity,
    HardBreak,
    Escape,
    Strikethrough,
    Text,
    AsteriskRun,
    UnderscoreRun,
    EmphasisOpen,
    EmphasisClose,
    StrongOpen,
    StrongClose,
    ImageOpen,
    BracketOpen,
    LinkTail,
    ReferenceTail,
    ShortcutReferenceTail,
    ReferenceSeparatorClose,
    LinkOpen,
    LinkClose,
    ImageLinkOpen,
    ImageLinkClose,
    ReferenceOpen,
    ReferenceClose,
    ImageReferenceOpen,
    ImageReferenceClose,
    InlineComponentOpen,
    InlineComponentLabelOpen,
    InlineComponentLabelClose,
    Attributes,
    InlineSpanOpen,
    InlineSpanClose,
    Delimiter,
    Newline,
    InlineBoundary,
  },
  rules: {
    Inline,
    InlineLine,
    InlineLines,
    InlineForest,
    Emphasis,
    Strong,
    LinkEmphasis,
    LinkStrong,
    Image,
    Link,
    ReferenceLink,
    ReferenceImage,
    LinkImage,
    LinkReferenceImage,
    InlineComponent,
    InlineSpan,
    LinkComponent,
    LinkSpan,
    LinkContent,
    BracketFallback,
  },
  entry: BracketFallback,
  newline: {
    token: "Newline",
    hardBreak: { token: "HardBreak", minSpaces: 2 },
  },
});
