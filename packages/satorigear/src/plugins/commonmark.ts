import {
  atxHeadingInterrupt,
  atxHeadingStart,
  blockQuoteInterrupt,
  blockQuoteStart,
  fencedCodeInterrupt,
  fencedCodeStart,
  htmlBlockInterrupt,
  htmlBlockStart,
  indentedCodeStart,
  linkDefinitionStart,
  listInterrupt,
  listStart,
  paragraphStart,
  thematicBreakInterrupt,
  thematicBreakStart,
} from "../block/scanner.ts";
import {
  markdownBracketPairs,
  markdownDelimiterRuns,
  reassociateReferenceTails,
} from "../inline/tokenizer.ts";
import {
  defineSyntaxProfile,
  type InternalSyntaxPlugin,
  projectAtxHeading,
  projectBlockQuote,
  projectFencedCode,
  projectHtmlBlock,
  projectIndentedCode,
  projectInlineAutolink,
  projectInlineBreak,
  projectInlineCode,
  projectInlineHtml,
  projectInlineIgnore,
  projectInlineNewline,
  projectInlineText,
  projectLinkDefinition,
  projectOrderedList,
  projectParagraph,
  projectSetextHeading,
  projectThematicBreak,
  projectUnorderedList,
} from "./profile.ts";

const flowBlocks = {
  blockRules: [
    { rule: "AtxHeading", inlineContent: true, project: projectAtxHeading },
    { rule: "SetextHeading", inlineContent: true, project: projectSetextHeading },
    { rule: "Paragraph", inlineContent: true, project: projectParagraph },
    { rule: "ThematicBreak", project: projectThematicBreak },
  ],
  blockStarts: [
    {
      codes: [35],
      interrupt: atxHeadingInterrupt,
      start: atxHeadingStart,
    },
    {
      codes: [42, 45, 95],
      interrupt: thematicBreakInterrupt,
      start: thematicBreakStart,
    },
  ],
} satisfies InternalSyntaxPlugin;

const containerBlocks = {
  blockRules: [
    { rule: "BlockQuote", project: projectBlockQuote },
    { rule: "UnorderedList", project: projectUnorderedList },
    { rule: "OrderedList", project: projectOrderedList },
  ],
  blockStarts: [
    {
      codes: [62],
      interrupt: blockQuoteInterrupt,
      start: blockQuoteStart,
    },
    {
      codes: [42, 43, 45, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57],
      interrupt: listInterrupt,
      start: listStart,
    },
  ],
} satisfies InternalSyntaxPlugin;

const literalBlocks = {
  blockRules: [
    { rule: "FencedCode", project: projectFencedCode },
    { rule: "IndentedCodeBlock", project: projectIndentedCode },
    { rule: "HtmlBlock", project: projectHtmlBlock },
  ],
  blockStarts: [
    {
      codes: [96, 126],
      interrupt: fencedCodeInterrupt,
      start: fencedCodeStart,
    },
    {
      codes: [60],
      interrupt: htmlBlockInterrupt,
      start: htmlBlockStart,
    },
  ],
} satisfies InternalSyntaxPlugin;

const referenceBlocks = {
  blockRules: [{
    rule: "LinkDefinition",
    project: projectLinkDefinition,
    referenceDefinition: true,
  }],
  blockStarts: [{ codes: [91], start: linkDefinitionStart }],
} satisfies InternalSyntaxPlugin;

const fallbackBlocks = {
  blockFallbacks: [indentedCodeStart, paragraphStart],
} satisfies InternalSyntaxPlugin;

const inlineAtoms = {
  inlineTokens: [
    { token: "Text", project: projectInlineText },
    { token: "Escape", project: projectInlineText },
    { token: "Entity", project: projectInlineText },
    { token: "CodeSpan", project: projectInlineCode },
    { token: "InlineHtml", project: projectInlineHtml },
    { token: "HtmlComment", project: projectInlineHtml },
    { token: "HardBreak", project: projectInlineBreak },
    { token: "Newline", project: projectInlineNewline },
    { token: "Autolink", project: projectInlineAutolink },
  ],
} satisfies InternalSyntaxPlugin;

const inlineFormatting = {
  delimiterRuns: markdownDelimiterRuns,
  inlineTokens: [
    { token: "Delimiter", project: projectInlineText },
    { token: "Strikethrough", project: projectInlineText },
    { token: "EmphasisOpen", project: projectInlineIgnore },
    { token: "EmphasisClose", project: projectInlineIgnore },
    { token: "StrongOpen", project: projectInlineIgnore },
    { token: "StrongClose", project: projectInlineIgnore },
  ],
} satisfies InternalSyntaxPlugin;

const inlineLinks = {
  inlineTokens: [
    { token: "BracketOpen", project: projectInlineText },
    { token: "ImageOpen", project: projectInlineText },
    { token: "LinkTail", project: projectInlineText },
    { token: "ReferenceTail", project: projectInlineText },
    { token: "ShortcutReferenceTail", project: projectInlineText },
    { token: "ReferenceSeparatorClose", project: projectInlineText },
    { token: "LinkOpen", project: projectInlineIgnore },
    { token: "LinkClose", project: projectInlineIgnore },
    { token: "ReferenceOpen", project: projectInlineIgnore },
    { token: "ReferenceClose", project: projectInlineIgnore },
    { token: "ImageLinkOpen", project: projectInlineIgnore },
    { token: "ImageLinkClose", project: projectInlineIgnore },
    { token: "ImageReferenceOpen", project: projectInlineIgnore },
    { token: "ImageReferenceClose", project: projectInlineIgnore },
  ],
  inlineTransforms: [reassociateReferenceTails],
  tokenPairs: markdownBracketPairs,
} satisfies InternalSyntaxPlugin;

export const commonmarkProfile = defineSyntaxProfile([
  flowBlocks,
  containerBlocks,
  literalBlocks,
  referenceBlocks,
  fallbackBlocks,
  inlineAtoms,
  inlineFormatting,
  inlineLinks,
]);
