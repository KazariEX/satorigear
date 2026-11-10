// Syntax flags occupy the low bits while structural roles occupy the high bits, so token
// traversal can recover both without consulting the profile.
export const enum BlockFlag {
  InlineContent = 1 << 5,
}

export const enum BlockRole {
  Raw,
  Open = 1 << 6,
  Close = 3 << 6,
  Leaf = 4 << 6,
}

export const enum BlockKind {
  None,
  InlineChunk,
  BlockComponentAttributes,

  BlockQuoteOpen = BlockRole.Open,
  UnorderedListOpen,
  OrderedListOpen,
  FootnoteDefinitionOpen,
  TableOpen,
  BlockComponentOpen,
  BlockComponentSlotOpen,
  ListItemOpen,
  UncheckedTaskItemOpen,
  CheckedTaskItemOpen,
  TableRowOpen,

  AtxHeading1Open = BlockRole.Open | BlockFlag.InlineContent,
  AtxHeading2Open,
  AtxHeading3Open,
  AtxHeading4Open,
  AtxHeading5Open,
  AtxHeading6Open,
  SetextHeading1Open,
  SetextHeading2Open,
  ParagraphOpen,
  TableCellStart,
  BlockComponentLabelOpen,

  BlockQuoteClose = BlockRole.Close,
  ListItemClose,
  ListItemSpreadClose,
  ListClose,
  ListSpreadClose,
  FootnoteDefinitionClose,
  TableClose,
  TableRowClose,
  BlockComponentClose,
  BlockComponentLabelClose,
  BlockComponentSlotClose,

  ThematicBreak = BlockRole.Leaf,
  LinkDefinition,
  FencedCodeBlock,
  IndentedCodeBlock,
  HtmlBlock,
  Frontmatter,
  MathBlock,
  BlockComponentYamlProps,
  TableAlignNone,
  TableAlignLeft,
  TableAlignRight,
  TableAlignCenter,
}
