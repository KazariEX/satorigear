// These stable kinds cover raw lexer output, feature rewrites, pairing output, and arena boundaries.
export function inlineKind(name: string): number {
  switch (name) {
    case "HtmlComment": return 1;
    case "CodeSpan": return 2;
    case "MathText": return 3;
    case "Autolink": return 4;
    case "InlineHtml": return 5;
    case "Entity": return 6;
    case "HardBreak": return 7;
    case "Escape": return 8;
    case "Text": return 9;
    case "AsteriskRun": return 10;
    case "UnderscoreRun": return 11;
    case "TildeRun": return 12;
    case "EmphasisOpen": return 13;
    case "EmphasisClose": return 14;
    case "StrongOpen": return 15;
    case "StrongClose": return 16;
    case "ImageOpen": return 17;
    case "BracketOpen": return 18;
    case "LinkTail": return 19;
    case "ReferenceTail": return 20;
    case "ShortcutReferenceTail": return 21;
    case "ReferenceSeparatorClose": return 22;
    case "LinkOpen": return 23;
    case "LinkClose": return 24;
    case "ImageLinkOpen": return 25;
    case "ImageLinkClose": return 26;
    case "ReferenceOpen": return 27;
    case "ReferenceClose": return 28;
    case "ImageReferenceOpen": return 29;
    case "ImageReferenceClose": return 30;
    case "FootnoteReference": return 31;
    case "InlineComponentOpen": return 32;
    case "InlineComponentLabelOpen": return 33;
    case "InlineComponentLabelClose": return 34;
    case "Attributes": return 35;
    case "InlineSpanOpen": return 36;
    case "InlineSpanClose": return 37;
    case "Delimiter": return 38;
    case "Newline": return 39;
    case "InlineBoundary": return 40;
    default: throw new Error(`Unknown inline token ${name}`);
  }
}
