const names = [
  "",
  "HtmlComment",
  "CodeSpan",
  "MathText",
  "Autolink",
  "InlineHtml",
  "Entity",
  "HardBreak",
  "Escape",
  "Text",
  "AsteriskRun",
  "UnderscoreRun",
  "TildeRun",
  "EmphasisOpen",
  "EmphasisClose",
  "StrongOpen",
  "StrongClose",
  "ImageOpen",
  "BracketOpen",
  "LinkTail",
  "ReferenceTail",
  "ShortcutReferenceTail",
  "ReferenceSeparatorClose",
  "LinkOpen",
  "LinkClose",
  "ImageLinkOpen",
  "ImageLinkClose",
  "ReferenceOpen",
  "ReferenceClose",
  "ImageReferenceOpen",
  "ImageReferenceClose",
  "FootnoteReference",
  "InlineComponentOpen",
  "InlineComponentLabelOpen",
  "InlineComponentLabelClose",
  "Attributes",
  "InlineSpanOpen",
  "InlineSpanClose",
  "Delimiter",
  "Newline",
  "InlineBoundary",
] as const;

const kinds: Record<string, number | undefined> = Object.create(null);
for (let kind = 1; kind < names.length; kind++) {
  kinds[names[kind]] = kind;
}

// Raw lexing, feature rewrites, pairing, and projection share this stable vocabulary.
export function inlineKind(name: string): number {
  const kind = kinds[name];
  if (kind === void 0) {
    throw new Error(`Unknown inline token ${name}`);
  }
  return kind;
}

export function inlineKindName(kind: number): string {
  const name = names[kind];
  if (name === void 0) {
    throw new Error(`Unknown inline token kind ${kind}`);
  }
  return name;
}
