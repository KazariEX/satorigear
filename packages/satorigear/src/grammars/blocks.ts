import { alt, defineGrammar, many, many1, never, rule, type RuleRef, token } from "monogram/api.ts";

const ParagraphOpen = token(never());
const ParagraphClose = token(never());
const AtxHeadingOpen = token(never());
const SetextHeading1Open = token(never());
const SetextHeading2Open = token(never());
const HeadingClose = token(never());
const BlockQuoteOpen = token(never());
const BlockQuoteClose = token(never());
const UnorderedListOpen = token(never());
const UnorderedListClose = token(never());
const UnorderedItemOpen = token(never());
const UnorderedItemClose = token(never());
const OrderedListOpen = token(never());
const OrderedListClose = token(never());
const OrderedItemOpen = token(never());
const OrderedItemClose = token(never());
const InlineChunk = token(never());
const FencedCodeBlock = token(never());
const IndentedCodeBlockToken = token(never());
const ThematicBreakToken = token(never());
const HtmlBlockToken = token(never());
const LinkDefinitionOpen = token(never());
const LinkDefinitionChunk = token(never());
const LinkDefinitionClose = token(never());

const Paragraph = rule(() => [[ParagraphOpen, many1(InlineChunk), ParagraphClose]]);
const AtxHeading = rule(() => [[AtxHeadingOpen, many(InlineChunk), HeadingClose]]);
const SetextHeading = rule(() => [[alt(SetextHeading1Open, SetextHeading2Open), many1(InlineChunk), HeadingClose]]);
const FencedCode = rule(() => [FencedCodeBlock]);
const IndentedCodeBlock = rule(() => [IndentedCodeBlockToken]);
const ThematicBreak = rule(() => [ThematicBreakToken]);
const HtmlBlock = rule(() => [HtmlBlockToken]);
const LinkDefinition = rule(() => [[LinkDefinitionOpen, many1(LinkDefinitionChunk), LinkDefinitionClose]]);
let Block: RuleRef;
const BlockQuote = rule(() => [[BlockQuoteOpen, many(Block), BlockQuoteClose]]);
const UnorderedListItem = rule(() => [[UnorderedItemOpen, many(Block), UnorderedItemClose]]);
const OrderedListItem = rule(() => [[OrderedItemOpen, many(Block), OrderedItemClose]]);
const UnorderedList = rule(() => [[UnorderedListOpen, many1(UnorderedListItem), UnorderedListClose]]);
const OrderedList = rule(() => [[OrderedListOpen, many1(OrderedListItem), OrderedListClose]]);
Block = rule(() => [
  AtxHeading,
  SetextHeading,
  ThematicBreak,
  FencedCode,
  IndentedCodeBlock,
  HtmlBlock,
  LinkDefinition,
  BlockQuote,
  UnorderedList,
  OrderedList,
  Paragraph,
]);
const Document = rule(() => [[many(Block)]]);

export const markdownBlockGrammar = defineGrammar({
  name: "markdown-blocks",
  tokens: {
    ParagraphOpen,
    ParagraphClose,
    AtxHeadingOpen,
    SetextHeading1Open,
    SetextHeading2Open,
    HeadingClose,
    BlockQuoteOpen,
    BlockQuoteClose,
    UnorderedListOpen,
    UnorderedListClose,
    UnorderedItemOpen,
    UnorderedItemClose,
    OrderedListOpen,
    OrderedListClose,
    OrderedItemOpen,
    OrderedItemClose,
    InlineChunk,
    FencedCodeBlock,
    IndentedCodeBlockToken,
    ThematicBreakToken,
    HtmlBlockToken,
    LinkDefinitionOpen,
    LinkDefinitionChunk,
    LinkDefinitionClose,
  },
  rules: {
    Paragraph,
    AtxHeading,
    SetextHeading,
    FencedCode,
    IndentedCodeBlock,
    HtmlBlock,
    LinkDefinition,
    ThematicBreak,
    BlockQuote,
    UnorderedListItem,
    OrderedListItem,
    UnorderedList,
    OrderedList,
    Block,
    Document,
  },
  entry: Document,
});
