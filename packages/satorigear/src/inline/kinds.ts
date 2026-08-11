const fallbackKind = 44;

// Stable kinds let the resolver and semantic arena outlive the generated lexer that
// currently produces them. The build verifies this registry against generated output.
export function inlineKind(type: string): number {
  switch (type) {
    case "": return 1;
    case "$templateHead": return 2;
    case "$templateMiddle": return 3;
    case "$templateTail": return 4;
    case "HtmlComment": return 5;
    case "CodeSpan": return 6;
    case "MathText": return 7;
    case "Autolink": return 8;
    case "InlineHtml": return 9;
    case "Entity": return 10;
    case "HardBreak": return 11;
    case "Escape": return 12;
    case "Text": return 13;
    case "AsteriskRun": return 14;
    case "UnderscoreRun": return 15;
    case "TildeRun": return 16;
    case "EmphasisOpen": return 17;
    case "EmphasisClose": return 18;
    case "StrongOpen": return 19;
    case "StrongClose": return 20;
    case "ImageOpen": return 21;
    case "BracketOpen": return 22;
    case "LinkTail": return 23;
    case "ReferenceTail": return 24;
    case "ShortcutReferenceTail": return 25;
    case "ReferenceSeparatorClose": return 26;
    case "LinkOpen": return 27;
    case "LinkClose": return 28;
    case "ImageLinkOpen": return 29;
    case "ImageLinkClose": return 30;
    case "ReferenceOpen": return 31;
    case "ReferenceClose": return 32;
    case "ImageReferenceOpen": return 33;
    case "ImageReferenceClose": return 34;
    case "FootnoteReference": return 35;
    case "InlineComponentOpen": return 36;
    case "InlineComponentLabelOpen": return 37;
    case "InlineComponentLabelClose": return 38;
    case "Attributes": return 39;
    case "InlineSpanOpen": return 40;
    case "InlineSpanClose": return 41;
    case "Delimiter": return 42;
    case "Newline": return 43;
    case "InlineBoundary":
    case "$error": return fallbackKind;
    default: return fallbackKind;
  }
}
