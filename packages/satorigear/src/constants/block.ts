// Structural roles index token ranges; inline content is represented by owned chunks.
export const enum BlockRole {
  Raw,
  Open = 1 << 6,
  Close = 3 << 6,
  Leaf = 4 << 6,
}

export const enum BlockFlag {
  ListSpread = 1 << 5,
}

export const enum BlockKind {
  None,
  InlineChunk,
  BlockComponentAttributes,

  AtxHeading1Open = BlockRole.Open,
  AtxHeading2Open,
  AtxHeading3Open,
  AtxHeading4Open,
  AtxHeading5Open,
  AtxHeading6Open,
  SetextHeading1Open,
  SetextHeading2Open,
  BlockQuoteOpen,
  UnorderedListOpen,
  OrderedListOpen,
  ListItemOpen,
  UncheckedTaskItemOpen,
  CheckedTaskItemOpen,
  FootnoteDefinitionOpen,
  ParagraphOpen,
  TableOpen,
  TableRowOpen,
  TableCellOpen,
  BlockComponentOpen,
  BlockComponentSlotOpen,
  BlockComponentLabelOpen,

  SpreadListItemOpen = ListItemOpen | BlockFlag.ListSpread,
  UncheckedSpreadTaskItemOpen = UncheckedTaskItemOpen | BlockFlag.ListSpread,
  CheckedSpreadTaskItemOpen = CheckedTaskItemOpen | BlockFlag.ListSpread,

  BlockQuoteClose = BlockRole.Close,
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

export const boundaryBreak = Symbol();
