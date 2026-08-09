import { thematicBreakInterrupt, thematicBreakStart } from "../block/scanner.ts";
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
  blockStarts: [{
    codes: [42, 45, 95],
    interrupt: thematicBreakInterrupt,
    start: thematicBreakStart,
  }],
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
} satisfies InternalSyntaxPlugin;

const referenceBlocks = {
  blockRules: [{ rule: "LinkDefinition", project: projectLinkDefinition }],
} satisfies InternalSyntaxPlugin;

export const commonmarkProfile = defineSyntaxProfile([
  flowBlocks,
  containerBlocks,
  literalBlocks,
  referenceBlocks,
]);
