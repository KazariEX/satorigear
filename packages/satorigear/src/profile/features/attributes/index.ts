import type { Blockquote, Heading, List, Paragraph, PhrasingContent } from "mdast";
import { BlockRule } from "../../../constants/block.ts";
import { Character } from "../../../constants/character.ts";
import { InlineKind } from "../../../constants/inline.ts";
import { extendSpan, type SpannedNode } from "../../../fragment/node.ts";
import {
  appendInlineToken,
  inlineTokenCount,
  inlineTokenEnd,
  InlineTokenFlag,
  inlineTokenFlags,
  inlineTokenKind,
  inlineTokenStart,
  setInlineTokenFlags,
} from "../../../inline/tokens.ts";
import { attributesEnd, mergeAttributes, parseAttributes } from "./syntax.ts";
import type { BlockNodeBuilderDecorator } from "../../../block/profile.ts";
import type { SyntaxFeature } from "../../types.ts";
import type { Attributes } from "./types.ts";

type AttributableNode = SpannedNode<PhrasingContent> & { attributes?: Attributes };

// Terminal attributes belong to the enclosing block, so this feature extends the transient
// inline result instead of attaching private state to its MDAST children array.
declare module "../../../fragment/inline.ts" {
  interface InlineFragment {
    attributes?: Attributes;
  }
}

const decorateInlineContainer: BlockNodeBuilderDecorator = (build) => (tokenStart, context, inline) => {
  const result = build(tokenStart, context, inline) as SpannedNode<Paragraph | Heading>;
  if (inline?.attributes) {
    result.attributes = inline.attributes;
  }
  return result;
};

const decorateList: BlockNodeBuilderDecorator = (build) => (tokenStart, context) => {
  const result = build(tokenStart, context) as SpannedNode<List>;
  if (!result.spread) {
    for (const item of result.children) {
      const paragraph = !item.spread && item.children.length === 1 && item.children[0].type === "paragraph"
        ? item.children[0]
        : void 0;
      if (paragraph?.attributes) {
        item.attributes = paragraph.attributes;
        delete paragraph.attributes;
      }
    }
  }
  return result;
};

const decorateBlockquote: BlockNodeBuilderDecorator = (build) => (tokenStart, context) => {
  const result = build(tokenStart, context) as SpannedNode<Blockquote>;
  const paragraph = result.children.length === 1 && result.children[0].type === "paragraph"
    ? result.children[0]
    : void 0;
  if (paragraph?.attributes) {
    result.attributes = paragraph.attributes;
    delete paragraph.attributes;
  }
  return result;
};

function isMarkdownWhitespace(code: number): boolean {
  return (
    code === Character.CharacterTabulation ||
    code === Character.LineFeed ||
    code === Character.CarriageReturn ||
    code === Character.Space
  );
}

function hasVisibleText(source: string, start: number, end: number): boolean {
  for (let offset = start; offset < end; offset++) {
    if (!isMarkdownWhitespace(source.charCodeAt(offset))) {
      return true;
    }
  }
  return false;
}

function attributeEndAt(source: string, start: number): number | undefined {
  return source[start + 1] === "{" || source[start - 1] === "{" || source[start - 1] === "$"
    ? void 0
    : attributesEnd(source, start);
}

function scanAttribute(source: string, start: number, tokens: number[]): number {
  const end = attributeEndAt(source, start);
  if (end === void 0) {
    return -1;
  }

  if (tokens.length === 0 && !hasVisibleText(source, 0, start)) {
    // Leading attribute bags are literal. Consume the whole leading chain so a later bag
    // cannot mistake an earlier literal bag for attachable content.
    let textEnd = end;
    while (true) {
      let next = textEnd;
      while (
        source.charCodeAt(next) === Character.CharacterTabulation ||
        source.charCodeAt(next) === Character.Space
      ) {
        next++;
      }
      const nextEnd = source.charCodeAt(next) === Character.LeftCurlyBracket
        ? attributeEndAt(source, next)
        : void 0;
      if (nextEnd === void 0) {
        break;
      }
      textEnd = nextEnd;
    }
    return textEnd;
  }

  const previous = inlineTokenCount(tokens) - 1;
  const previousEnd = previous >= 0 ? inlineTokenEnd(tokens, previous) : 0;
  if (
    previousEnd < start && (
      previous >= 0 && inlineTokenKind(tokens, previous) === InlineKind.AttributesToken ||
      hasVisibleText(source, previousEnd, start)
    )
  ) {
    // The decorator needs the preceding source gap to exist as a node before it runs.
    appendInlineToken(tokens, InlineKind.LiteralText, previousEnd, start);
  }

  appendInlineToken(
    tokens,
    InlineKind.AttributesToken,
    start,
    end,
    start > 0 && isMarkdownWhitespace(source.charCodeAt(start - 1))
      ? InlineTokenFlag.AttributeDetached
      : 0,
  );

  let next = end;
  while (isMarkdownWhitespace(source.charCodeAt(next))) {
    next++;
  }
  if (next === source.length) {
    for (let index = inlineTokenCount(tokens) - 1; index >= 0; index--) {
      const kind = inlineTokenKind(tokens, index);
      if (
        kind === InlineKind.LiteralText &&
        !hasVisibleText(source, inlineTokenStart(tokens, index), inlineTokenEnd(tokens, index))
      ) {
        continue;
      }
      if (kind !== InlineKind.AttributesToken) {
        break;
      }
      setInlineTokenFlags(
        tokens,
        index,
        inlineTokenFlags(tokens, index) | InlineTokenFlag.AttributeTerminal,
      );
    }
  }
  return end;
}

export const feature: SyntaxFeature = {
  block: {
    decorators: [
      { rule: BlockRule.Paragraph, decorate: decorateInlineContainer },
      { rule: BlockRule.AtxHeading, decorate: decorateInlineContainer },
      { rule: BlockRule.SetextHeading, decorate: decorateInlineContainer },
      { rule: BlockRule.UnorderedList, decorate: decorateList },
      { rule: BlockRule.OrderedList, decorate: decorateList },
      { rule: BlockRule.BlockQuote, decorate: decorateBlockquote },
    ],
  },
  inline: {
    scan: [
      { marker: Character.LeftCurlyBracket, scan: scanAttribute },
    ],
    build: [
      {
        kind: "decorate",
        token: InlineKind.AttributesToken,
        apply(tokenIndex, sourceSpan, context, target) {
          // mdast extensions may declare unrelated `attributes` shapes; this parser only emits ours.
          const previous = target.children.at(-1) as AttributableNode | undefined;
          const parsed = parseAttributes(
            context.view.text,
            inlineTokenStart(context.tokens, tokenIndex),
          );
          if (!previous || !parsed) {
            return false;
          }
          const flags = inlineTokenFlags(context.tokens, tokenIndex);
          const terminal = Boolean(flags & InlineTokenFlag.AttributeTerminal);
          const detached = Boolean(flags & InlineTokenFlag.AttributeDetached);
          if (
            terminal && (
              detached ||
              previous.type === "text" ||
              target.attributes !== void 0
            )
          ) {
            if (target.attributes) {
              mergeAttributes(target.attributes, parsed.attributes);
            }
            else {
              target.attributes = parsed.attributes;
            }
            return true;
          }
          if (previous.attributes) {
            mergeAttributes(previous.attributes, parsed.attributes);
          }
          else {
            previous.attributes = parsed.attributes;
          }
          extendSpan(previous, sourceSpan.end);
          return true;
        },
      },
    ],
  },
};
