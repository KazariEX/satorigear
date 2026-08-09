import {
  atxHeadingInterrupt,
  atxHeadingStart,
  fencedCodeInterrupt,
  fencedCodeStart,
  htmlBlockInterrupt,
  htmlBlockStart,
  linkDefinitionStart,
  thematicBreakInterrupt,
  thematicBreakStart,
} from "../block/scanner.ts";
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

export const commonmarkProfile = defineSyntaxProfile([
  flowBlocks,
  containerBlocks,
  literalBlocks,
  referenceBlocks,
]);
