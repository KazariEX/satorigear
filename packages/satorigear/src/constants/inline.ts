// Projection roles occupy the high bits so resolved tokens carry their build path.
export const enum InlineRole {
  Raw,
  Text = 1 << 6,
  Leaf = 2 << 6,
  Pair = 3 << 6,
  Decorate = 4 << 6,
}

export const enum InlineKind {
  None,

  // Raw candidates become source gaps unless resolution gives them semantic meaning.
  AsteriskRun,
  UnderscoreRun,
  TildeRun,
  ImageOpen,
  BracketOpen,
  BracketClose,

  LiteralText = InlineRole.Text,
  Escape,
  Entity,
  Newline,
  // An unmatched resource tail still decodes escapes and entities.
  LinkTail,

  HardBreak = InlineRole.Leaf,
  CodeSpan,
  HtmlComment,
  InlineHtml,
  Autolink,
  FootnoteReference,
  MathText,
  Binding,
  Emoji,
  InlineComponent,

  // Pair kinds alternate even opens and odd closes; resolution keeps them properly nested.
  EmphasisOpen = InlineRole.Pair,
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

  Attributes = InlineRole.Decorate,
}
