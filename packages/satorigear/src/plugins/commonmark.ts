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
  projectLinkDefinition,
  projectOrderedList,
  projectParagraph,
  projectSetextHeading,
  projectThematicBreak,
  projectUnorderedList,
} from "./profile.ts";

const flowBlocks = {
  blockRules: [
    { rule: "AtxHeading", project: projectAtxHeading },
    { rule: "SetextHeading", project: projectSetextHeading },
    { rule: "Paragraph", project: projectParagraph },
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
  blockRules: [{ rule: "LinkDefinition", project: projectLinkDefinition }],
  blockStarts: [{ codes: [91], start: linkDefinitionStart }],
} satisfies InternalSyntaxPlugin;

const fallbackBlocks = {
  blockFallbacks: [indentedCodeStart, paragraphStart],
} satisfies InternalSyntaxPlugin;

const inlineSyntax = {
  delimiterRuns: markdownDelimiterRuns,
  inlineTransforms: [reassociateReferenceTails],
  tokenPairs: markdownBracketPairs,
} satisfies InternalSyntaxPlugin;

export const commonmarkProfile = defineSyntaxProfile([
  flowBlocks,
  containerBlocks,
  literalBlocks,
  referenceBlocks,
  fallbackBlocks,
  inlineSyntax,
]);
