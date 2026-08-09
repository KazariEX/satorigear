import { linkDefinitionFields } from "../block/tokens.ts";
import { projectInlineChildren, projectInlineIgnore } from "../mdast.ts";
import {
  blockQuoteInterrupt,
  blockQuoteStart,
  projectBlockQuote,
  unwrapBlockQuote,
} from "./commonmark/blockquote.ts";
import {
  projectInlineBreak,
  projectInlineNewline,
  projectThematicBreak,
  thematicBreakInterrupt,
  thematicBreakStart,
} from "./commonmark/break.ts";
import {
  fencedCodeInterrupt,
  fencedCodeStart,
  indentedCodeStart,
  projectFencedCode,
  projectIndentedCode,
  projectInlineCode,
} from "./commonmark/code.ts";
import { projectLinkDefinition } from "./commonmark/definition.ts";
import {
  markdownDelimiterRuns,
  projectInlineEmphasis,
  projectInlineStrong,
} from "./commonmark/emphasis.ts";
import {
  atxHeadingInterrupt,
  atxHeadingStart,
  projectAtxHeading,
  projectSetextHeading,
} from "./commonmark/heading.ts";
import {
  htmlBlockInterrupt,
  htmlBlockStart,
  projectHtmlBlock,
  projectInlineHtml,
} from "./commonmark/html.ts";
import {
  projectInlineAutolink,
  projectInlineImage,
  projectInlineLink,
  projectInlineReferenceImage,
  projectInlineReferenceLink,
} from "./commonmark/link.ts";
import {
  listInterrupt,
  listStart,
  projectOrderedList,
  projectUnorderedList,
  unwrapListItem,
} from "./commonmark/list.ts";
import { paragraphStart, projectParagraph } from "./commonmark/paragraph.ts";
import {
  linkDefinitionStart,
  markdownBracketPairs,
  reassociateReferenceTails,
  restartBeforeLinkDefinition,
} from "./commonmark/reference.ts";
import { projectInlineText, semanticText } from "./commonmark/text.ts";
import { defineSyntaxProfile, type InternalSyntaxPlugin } from "./profile.ts";

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
  blockUnwrappers: [unwrapBlockQuote, unwrapListItem],
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
  blockRestarts: [restartBeforeLinkDefinition],
  blockRules: [{
    rule: "LinkDefinition",
    project: projectLinkDefinition,
    referenceLabel: (token) => linkDefinitionFields(token).normalizedLabel,
  }],
  blockStarts: [{ codes: [91], start: linkDefinitionStart }],
} satisfies InternalSyntaxPlugin;

const fallbackBlocks = {
  blockFallbacks: [indentedCodeStart, paragraphStart],
} satisfies InternalSyntaxPlugin;

const inlineAtoms = {
  decodeText: semanticText,
  inlineRules: [
    { rule: "InlineLines", project: projectInlineChildren },
    { rule: "InlineLine", project: projectInlineChildren },
    { rule: "Inline", project: projectInlineChildren },
  ],
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
  inlineRules: [
    { rule: "Emphasis", project: projectInlineEmphasis },
    { rule: "LinkEmphasis", project: projectInlineEmphasis },
    { rule: "Strong", project: projectInlineStrong },
    { rule: "LinkStrong", project: projectInlineStrong },
  ],
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
  inlineRules: [
    { rule: "LinkContent", project: projectInlineChildren },
    { rule: "BracketFallback", project: projectInlineChildren },
    { rule: "Image", project: projectInlineImage },
    { rule: "LinkImage", project: projectInlineImage },
    { rule: "ReferenceImage", project: projectInlineReferenceImage },
    { rule: "LinkReferenceImage", project: projectInlineReferenceImage },
    { rule: "Link", project: projectInlineLink },
    { rule: "ReferenceLink", project: projectInlineReferenceLink },
  ],
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
