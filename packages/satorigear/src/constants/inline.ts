// Projection roles occupy the high bits so resolved tokens carry their build path.
export const enum InlineTokenRole {
  Raw,
  Text = 1 << 6,
  Leaf = 2 << 6,
  Pair = 3 << 6,
  Decorate = 4 << 6,
}

export const enum InlineKind {
  None,

  LiteralText = InlineTokenRole.Text,
  Escape,
  Entity,
  Newline,
  AsteriskRun,
  UnderscoreRun,
  TildeRun,
  ImageOpen,
  BracketOpen,
  LinkTail,
  BracketClose,

  HardBreak = InlineTokenRole.Leaf,
  CodeSpan,
  HtmlComment,
  InlineHtml,
  Autolink,
  FootnoteReference,
  MathText,
  Binding,
  Emoji,
  InlineComponent,

  // Pair kinds alternate open/close so projection can derive the matching boundary.
  EmphasisOpen = InlineTokenRole.Pair,
  EmphasisClose,
  StrongOpen,
  StrongClose,
  DeleteOpen,
  DeleteClose,
  LinkOpen,
  LinkClose,
  ImageLinkOpen,
  ImageLinkClose,
  ReferenceOpen,
  ReferenceClose,
  ImageReferenceOpen,
  ImageReferenceClose,
  InlineSpanOpen,
  InlineSpanClose,
  InlineComponentOpen,
  InlineComponentClose,

  Attributes = InlineTokenRole.Decorate,
}
