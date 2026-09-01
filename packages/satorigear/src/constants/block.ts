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
  LinkDefinitionChunk,
  BlockComponentAttributes,

  BlockQuoteOpen = BlockRole.BlockOpen,
  UnorderedListOpen,
  OrderedListOpen,
  LinkDefinitionOpen,
  FootnoteDefinitionOpen,
  TableOpen,
  BlockComponentOpen,
  BlockComponentSlotOpen,

  AtxHeadingOpen = BlockRole.BlockOpen | BlockFlag.InlineContent,
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
  HeadingClose,
  ParagraphClose,
  UnorderedListClose,
  OrderedListClose,
  ListItemClose,
  LinkDefinitionClose,
  FootnoteDefinitionClose,
  TableClose,
  TableRowClose,
  BlockComponentClose,
  BlockComponentLabelClose,
  BlockComponentSlotClose,

  ThematicBreak = BlockRole.Leaf,
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
