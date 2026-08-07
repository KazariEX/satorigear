// Markdown — a line-oriented CommonMark grammar on Monogram's shared core.
//
// Markdown differs from token-stream languages in two important ways: several markers are
// meaningful only as the first token of a logical line, and fenced code owns an opaque run of
// physical lines. Both behaviours are declared as lexer hints (`lineStart` / `fencedBlock`);
// the grammar below remains ordinary tokens + recursive-descent rules.
//
// This grammar intentionally models the context-free, editor-facing CommonMark surface. It
// recognises the principal block forms and the most useful inline forms, while leaving delimiter
// flanking/intraword emphasis and full HTML block-type classification to a future oracle-driven
// conformance pass.
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
  notFollowedBy,
  oneOf,
  opt,
  optPattern,
  plus,
  range,
  repeat,
  rule,
  seq,
  star,
  token,
} from "../../../vendors/monogram/src/api.ts";
import type { NewlineConfig } from "../../../vendors/monogram/src/types.ts";

const hspace = oneOf(" ", "\t");
const lineEnd = followedBy(altPattern("\r", "\n", end()));
const physicalLineEnd = followedBy(altPattern("\r", "\n"));
const digit = range("0", "9");
const punctuation = oneOf("!", "\"", "#", "$", "%", "&", "'", "(", ")", "*", "+", ",", "-", ".", "/", ":", ";", "<", "=", ">", "?", "@", "[", "\\", "]", "^", "_", "`", "{", "|", "}", "~");

// Engine-emitted structural/newline tokens.
const Newline = token(never(), {});
const IndentedCode = token(never(), { scope: "markup.raw.block" });

// A representative declarative pattern remains available for grammar inspection. The executable
// lexer uses fencedBlock to enforce same-marker / at-least-opener-length closing fences.
const FenceBlock = token(altPattern(
  seq("```", star(anyChar(), { greedy: false }), altPattern("```", end())),
  seq("~~~", star(anyChar(), { greedy: false }), altPattern("~~~", end())),
), {
  scope: "markup.fenced_code.block",
  lineStart: true,
  fencedBlock: { markers: ["`", "~"], minLength: 3, maxIndent: 3 },
});

// Block markers. Declaration order resolves the overlapping `*`/`-` families: a complete
// thematic break wins before a list marker; a dash break remains reusable as a setext underline
// through parser context below.
const ThematicBreak = token(altPattern(
  seq("*", repeat(seq(star(hspace), "*"), 2), star(hspace), lineEnd),
  seq("_", repeat(seq(star(hspace), "_"), 2), star(hspace), lineEnd),
), { scope: "meta.separator", lineStart: true });
const DashThematicBreak = token(
  seq("-", repeat(seq(star(hspace), "-"), 2), star(hspace), lineEnd),
  { scope: "meta.separator", lineStart: true },
);

const SetextUnderline = token(altPattern(
  seq(plus("="), star(hspace), lineEnd),
  seq(plus("-"), star(hspace), lineEnd),
), { scope: "markup.heading.setext", lineStart: true });

const AtxHeadingMarker = token(
  seq(repeat("#", 1, 6), followedBy(altPattern(hspace, "\r", "\n", end()))),
  { scope: "punctuation.definition.heading", lineStart: true },
);
const BlockQuoteMarker = token(seq(">", optPattern(hspace)), {
  scope: "punctuation.definition.blockquote",
  lineStart: true,
});
// A lone `-` is context-sensitive: by itself it is an empty list item, but after paragraph
// content it is a level-2 setext underline. A distinct whole-line token lets the parser decide
// without allowing the `- ` prefix of a non-empty list item to steal the preceding paragraph.
const EmptyDashMarker = token(seq("-", star(hspace), lineEnd), {
  scope: "punctuation.definition.list",
  lineStart: true,
});
const UnorderedListMarker = token(seq(oneOf("-", "+", "*"), followedBy(altPattern(hspace, "\r", "\n", end()))), {
  scope: "punctuation.definition.list",
  lineStart: true,
});
const OrderedListMarker = token(seq(repeat(digit, 1, 9), oneOf(".", ")"), followedBy(altPattern(hspace, "\r", "\n", end()))), {
  scope: "punctuation.definition.list",
  lineStart: true,
});

// A link reference definition owns its physical line. It precedes ordinary `[`-led inline links.
const LinkDefinition = token(seq(
  "[",
  plus(noneOf("]", "\n", "\r")),
  "]",
  ":",
  star(hspace),
  plus(noneOf("\n", "\r")),
), { scope: "meta.link.reference.def", lineStart: true });

// Inline leaves. Whole-construct tokens keep the parser grammar compact while preserving useful
// CST roles (code span, link, image, emphasis, HTML, entity, text).
const HtmlComment = token(seq("<!--", star(anyChar(), { greedy: false }), altPattern("-->", end())), {
  scope: "comment.block.html",
});
const CodeSpan = token(altPattern(
  seq("```", plus(noneOf("\n", "\r"), { greedy: false }), "```"),
  seq("``", plus(noneOf("\n", "\r"), { greedy: false }), "``"),
  seq("`", plus(noneOf("`", "\n", "\r")), "`"),
), {
  scope: "markup.raw.inline",
  delimitedSpan: { markers: ["`"], minLength: 1 },
});

const labelBody = star(altPattern(seq("\\", anyChar()), noneOf("]", "\n", "\r")));
const destination = altPattern(
  seq("<", star(noneOf(">", "\n", "\r")), ">"),
  plus(noneOf(" ", "\t", "\n", "\r", "(", ")")),
);
const optionalTitle = optPattern(plus(hspace), altPattern(
  seq("\"", star(noneOf("\"", "\n", "\r")), "\""),
  seq("'", star(noneOf("'", "\n", "\r")), "'"),
  seq("(", star(noneOf(")", "\n", "\r")), ")"),
));
const inlineLinkBody = seq("[", labelBody, "]", "(", star(hspace), optPattern(destination, optionalTitle), star(hspace), ")");
const Image = token(seq("!", inlineLinkBody), { scope: "meta.image.inline" });
const Link = token(inlineLinkBody, { scope: "meta.link.inline" });
const ReferenceLink = token(seq("[", labelBody, "]", altPattern(
  seq("[", star(noneOf("]", "\n", "\r")), "]"),
  seq(followedBy(altPattern(hspace, "\r", "\n", end()))),
)), { scope: "meta.link.reference" });

const Autolink = token(seq("<", altPattern(
  seq(oneOf(range("A", "Z"), range("a", "z")), star(oneOf(range("A", "Z"), range("a", "z"), digit, "+", ".", "-")), ":", plus(noneOf(" ", ">", "\n", "\r"))),
  seq(plus(noneOf(" ", "<", ">", "@", "\n", "\r")), "@", plus(noneOf(" ", "<", ">", "\n", "\r"))),
), ">"), { scope: "markup.underline.link" });
const InlineHtml = token(seq("<", optPattern("/"), oneOf(range("A", "Z"), range("a", "z")), star(noneOf(">", "\n", "\r")), ">"), {
  scope: "meta.tag.inline.html",
});
const Entity = token(seq("&", altPattern(
  seq("#", optPattern(oneOf("x", "X")), plus(oneOf(digit, range("A", "F"), range("a", "f")))),
  plus(oneOf(range("A", "Z"), range("a", "z"), digit)),
), ";"), { scope: "constant.character.entity" });
const HardBreak = token(altPattern(
  seq("\\", physicalLineEnd),
  seq("  ", star(" "), physicalLineEnd),
), { scope: "punctuation.definition.hard-break" });
const Escape = token(seq("\\", punctuation), { scope: "constant.character.escape" });

const Strong = token(altPattern(
  seq("**", plus(noneOf("\n", "\r"), { greedy: false }), "**"),
  seq("__", plus(noneOf("\n", "\r"), { greedy: false }), "__"),
), { scope: "markup.bold" });
const Strikethrough = token(seq("~~", plus(noneOf("\n", "\r"), { greedy: false }), "~~"), {
  scope: "markup.strikethrough",
});
const Emphasis = token(altPattern(
  seq("*", plus(noneOf("*", "\n", "\r")), "*"),
  seq("_", plus(noneOf("_", "\n", "\r")), "_"),
), { scope: "markup.italic" });

// Ordinary text consumes spaces in the middle of a run. The shared newline mode discards only
// insignificant leading/trailing horizontal separation before another inline token.
const textCharacter = altPattern(
  noneOf("\n", "\r", "\\", "`", "*", "_", "[", "<", "!", "&", "~", " "),
  // Leave a run of at least two spaces before a physical newline for HardBreak. A single
  // trailing space and all interior spaces remain ordinary text.
  seq(" ", notFollowedBy(seq(" ", star(" "), physicalLineEnd))),
);
const Text = token(plus(textCharacter), {
  scope: "meta.paragraph",
});
const Delimiter = token(oneOf("\\", "`", "*", "_", "[", "]", "<", ">", "!", "&", "~"), {
  scope: "punctuation.definition.markdown",
});

const Inline = rule(() => [
  HtmlComment,
  CodeSpan,
  Image,
  Link,
  ReferenceLink,
  Autolink,
  InlineHtml,
  Entity,
  HardBreak,
  Escape,
  Strong,
  Strikethrough,
  Emphasis,
  Text,
  Delimiter,
]);

// A paragraph/setext content run is left-recursive so it can span physical lines while stopping
// cleanly before the first line that cannot begin Inline (a block marker/fence/underline). Using a
// continuation instead of `many(Newline, InlineLine)` is important: the shared parser backtracks a
// failed left-recursive continuation as a unit, leaving the final Newline for SetextHeading.
const InlineLine = rule(() => [[many1(Inline)]]);
const InlineLines = rule(($) => [InlineLine, [$, Newline, InlineLine]]);
const AtxHeading = rule(() => [[AtxHeadingMarker, many(Inline)]]);
// A dash run is lexically a thematic break, but after paragraph text it is a setext underline.
// Keeping one token and resolving it in the parser is the Markdown-specific contextual choice.
const SetextHeading = rule(() => [[InlineLines, Newline, alt(SetextUnderline, DashThematicBreak, EmptyDashMarker)]]);
const BlockQuoteLine = rule(() => [[BlockQuoteMarker, many(Inline)]]);
const BlockQuote = rule(() => [[BlockQuoteLine, many(Newline, BlockQuoteLine)]]);
const UnorderedListItem = rule(() => [[alt(UnorderedListMarker, EmptyDashMarker), many(Inline)]]);
const OrderedListItem = rule(() => [[OrderedListMarker, many(Inline)]]);
const UnorderedList = rule(() => [[UnorderedListItem, many(Newline, UnorderedListItem)]]);
const OrderedList = rule(() => [[OrderedListItem, many(Newline, OrderedListItem)]]);
const FencedCode = rule(() => [FenceBlock]);
const IndentedCodeBlock = rule(() => [[IndentedCode, many(Newline, IndentedCode)]]);
const HtmlBlock = rule(() => [HtmlComment]);
const Paragraph = rule(() => [InlineLines, SetextUnderline]);

const Block = rule(() => [
  SetextHeading,
  AtxHeading,
  ThematicBreak,
  DashThematicBreak,
  BlockQuote,
  UnorderedList,
  OrderedList,
  FencedCode,
  IndentedCodeBlock,
  LinkDefinition,
  HtmlBlock,
  Paragraph,
]);
const Document = rule(() => [[opt(Block), many(Newline, opt(Block))]]);

const newline: NewlineConfig = {
  token: "Newline",
  hardBreak: { token: "HardBreak", minSpaces: 2 },
  indentedText: { token: "IndentedCode", minColumns: 4, tabWidth: 4 },
};

export default defineGrammar({
  name: "markdown",
  scopeName: "text.html.markdown",
  tokens: {
    FenceBlock,
    IndentedCode,
    ThematicBreak,
    DashThematicBreak,
    AtxHeadingMarker,
    BlockQuoteMarker,
    EmptyDashMarker,
    UnorderedListMarker,
    OrderedListMarker,
    SetextUnderline,
    LinkDefinition,
    HtmlComment,
    CodeSpan,
    Image,
    Link,
    ReferenceLink,
    Autolink,
    InlineHtml,
    Entity,
    HardBreak,
    Escape,
    Strong,
    Strikethrough,
    Emphasis,
    Text,
    Delimiter,
    Newline,
  },
  rules: {
    Inline,
    InlineLine,
    InlineLines,
    AtxHeading,
    SetextHeading,
    BlockQuoteLine,
    BlockQuote,
    UnorderedListItem,
    OrderedListItem,
    UnorderedList,
    OrderedList,
    FencedCode,
    IndentedCodeBlock,
    HtmlBlock,
    Paragraph,
    Block,
    Document,
  },
  entry: Document,
  newline,
  scopes: {
    "punctuation.definition.heading": [],
    "punctuation.definition.list": [],
    "punctuation.definition.blockquote": [],
  },
  manifest: {
    extensions: [".md", ".markdown"],
  },
});
