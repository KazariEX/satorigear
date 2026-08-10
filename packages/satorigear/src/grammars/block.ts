import { alt, defineGrammar, many, many1, never, opt, rule, type RuleRef, token } from "monogram/api.ts";

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
const FrontmatterToken = token(never());
const MathBlockToken = token(never());
const FencedCodeBlock = token(never());
const IndentedCodeBlockToken = token(never());
const ThematicBreakToken = token(never());
const HtmlBlockToken = token(never());
const TableOpen = token(never());
const TableCellOpen = token(never());
const TableCellClose = token(never());
const TableRowOpen = token(never());
const TableRowClose = token(never());
const TableAlignNone = token(never());
const TableAlignLeft = token(never());
const TableAlignRight = token(never());
const TableAlignCenter = token(never());
const TableClose = token(never());
const LinkDefinitionOpen = token(never());
const LinkDefinitionChunk = token(never());
const LinkDefinitionClose = token(never());
const FootnoteDefinitionOpen = token(never());
const FootnoteDefinitionClose = token(never());
const BlockComponentOpen = token(never());
const BlockComponentLabelOpen = token(never());
const BlockComponentLabelClose = token(never());
const BlockComponentAttributes = token(never());
const BlockComponentYamlProps = token(never());
const BlockComponentClose = token(never());
const BlockComponentSlotOpen = token(never());
const BlockComponentSlotClose = token(never());

const Paragraph = rule(() => [[ParagraphOpen, many1(InlineChunk), ParagraphClose]]);
const AtxHeading = rule(() => [[AtxHeadingOpen, many(InlineChunk), HeadingClose]]);
const SetextHeading = rule(() => [[alt(SetextHeading1Open, SetextHeading2Open), many1(InlineChunk), HeadingClose]]);
const Frontmatter = rule(() => [FrontmatterToken]);
const MathBlock = rule(() => [MathBlockToken]);
const FencedCode = rule(() => [FencedCodeBlock]);
const IndentedCodeBlock = rule(() => [IndentedCodeBlockToken]);
const ThematicBreak = rule(() => [ThematicBreakToken]);
const HtmlBlock = rule(() => [HtmlBlockToken]);
const TableCell = rule(() => [[TableCellOpen, many(InlineChunk), TableCellClose]]);
const TableRow = rule(() => [[TableRowOpen, many1(TableCell), TableRowClose]]);
const TableDelimiter = rule(() => [many1(alt(
  TableAlignNone,
  TableAlignLeft,
  TableAlignRight,
  TableAlignCenter,
))]);
const Table = rule(() => [[TableOpen, TableRow, TableDelimiter, many(TableRow), TableClose]]);
const LinkDefinition = rule(() => [[LinkDefinitionOpen, many1(LinkDefinitionChunk), LinkDefinitionClose]]);
let Block: RuleRef;
const FootnoteDefinition = rule(() => [[FootnoteDefinitionOpen, many(Block), FootnoteDefinitionClose]]);
const BlockComponentLabel = rule(() => [[
  BlockComponentLabelOpen,
  many(InlineChunk),
  BlockComponentLabelClose,
]]);
const BlockComponent = rule(() => [[
  BlockComponentOpen,
  opt(BlockComponentLabel),
  opt(BlockComponentAttributes),
  opt(BlockComponentYamlProps),
  many(Block),
  BlockComponentClose,
]]);
const BlockComponentSlot = rule(() => [[
  BlockComponentSlotOpen,
  opt(BlockComponentAttributes),
  many(Block),
  BlockComponentSlotClose,
]]);
const BlockQuote = rule(() => [[BlockQuoteOpen, many(Block), BlockQuoteClose]]);
const UnorderedListItem = rule(() => [[UnorderedItemOpen, many(Block), UnorderedItemClose]]);
const OrderedListItem = rule(() => [[OrderedItemOpen, many(Block), OrderedItemClose]]);
const UnorderedList = rule(() => [[UnorderedListOpen, many1(UnorderedListItem), UnorderedListClose]]);
const OrderedList = rule(() => [[OrderedListOpen, many1(OrderedListItem), OrderedListClose]]);
Block = rule(() => [
  Frontmatter,
  AtxHeading,
  SetextHeading,
  ThematicBreak,
  MathBlock,
  FencedCode,
  IndentedCodeBlock,
  HtmlBlock,
  Table,
  FootnoteDefinition,
  LinkDefinition,
  BlockComponent,
  BlockComponentSlot,
  BlockQuote,
  UnorderedList,
  OrderedList,
  Paragraph,
]);
const Document = rule(() => [[many(Block)]]);

export const grammar = defineGrammar({
  name: "markdown-block",
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
    FrontmatterToken,
    MathBlockToken,
    FencedCodeBlock,
    IndentedCodeBlockToken,
    ThematicBreakToken,
    HtmlBlockToken,
    TableOpen,
    TableCellOpen,
    TableCellClose,
    TableRowOpen,
    TableRowClose,
    TableAlignNone,
    TableAlignLeft,
    TableAlignRight,
    TableAlignCenter,
    TableClose,
    LinkDefinitionOpen,
    LinkDefinitionChunk,
    LinkDefinitionClose,
    FootnoteDefinitionOpen,
    FootnoteDefinitionClose,
    BlockComponentOpen,
    BlockComponentLabelOpen,
    BlockComponentLabelClose,
    BlockComponentAttributes,
    BlockComponentYamlProps,
    BlockComponentClose,
    BlockComponentSlotOpen,
    BlockComponentSlotClose,
  },
  rules: {
    Paragraph,
    AtxHeading,
    SetextHeading,
    Frontmatter,
    MathBlock,
    FencedCode,
    IndentedCodeBlock,
    HtmlBlock,
    TableCell,
    TableRow,
    TableDelimiter,
    Table,
    FootnoteDefinition,
    LinkDefinition,
    BlockComponentLabel,
    BlockComponent,
    BlockComponentSlot,
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
