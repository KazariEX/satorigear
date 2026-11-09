// Syntax flags occupy the low bits while structural roles occupy the high bits, so token
// traversal can recover both without consulting the profile.
export const enum BlockFlag {
  InlineContent = 1 << 5,
}

export const enum BlockRole {
  Raw,
  BlockOpen = 1 << 6,
  FrameOpen = 2 << 6,
  Close = 3 << 6,
  Leaf = 4 << 6,
  Group = 5 << 6,
  Mask = 7 << 6,
}

export const enum BlockKind {
  None,
  InlineChunk,
  BlockComponentAttributes,

  BlockQuoteOpen = BlockRole.BlockOpen,
  UnorderedListOpen,
  OrderedListOpen,
  FootnoteDefinitionOpen,
  TableOpen,
  BlockComponentOpen,
  BlockComponentSlotOpen,

  AtxHeading1Open = BlockRole.BlockOpen | BlockFlag.InlineContent,
  AtxHeading2Open,
  AtxHeading3Open,
  AtxHeading4Open,
  AtxHeading5Open,
  AtxHeading6Open,
  SetextHeading1Open,
  SetextHeading2Open,
  ParagraphOpen,

  ListItemOpen = BlockRole.FrameOpen,
  UncheckedTaskItemOpen,
  CheckedTaskItemOpen,
  TableRowOpen,

  TableCellStart = BlockRole.FrameOpen | BlockFlag.InlineContent,
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

  TableAlignNone = BlockRole.Group,
  TableAlignLeft,
  TableAlignRight,
  TableAlignCenter,
}
