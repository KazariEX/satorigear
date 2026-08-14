import type { Delete, Emphasis, Strong } from "mdast";
import {
  appendInline,
  type InlineNodeBuilder,
} from "../../fragment/inline.ts";
import { InlineKind } from "../../inline/kinds.ts";
import { type InlineLexicalRule, inlineMarkerRunEnd } from "../../inline/lexer.ts";
import { appendInlineToken } from "../../inline/tokens.ts";
import { buildInlineText } from "./text.ts";
import type { DelimiterConfig } from "../../inline/pairing.ts";
import type { SyntaxFeature } from "../types.ts";

const scanFormatting: InlineLexicalRule["scan"] = (source, start, tokens) => {
  const code = source.charCodeAt(start);
  const end = inlineMarkerRunEnd(source, start);
  const kind = code === 42
    ? InlineKind.AsteriskRun
    : code === 95 ? InlineKind.UnderscoreRun : InlineKind.TildeRun;
  appendInlineToken(tokens, kind, start, end);
  return end;
};

const asteriskDelimiter: DelimiterConfig = {
  token: InlineKind.AsteriskRun,
  marker: "*",
  fallbackToken: InlineKind.Delimiter,
  single: { open: InlineKind.EmphasisOpen, close: InlineKind.EmphasisClose },
  double: { open: InlineKind.StrongOpen, close: InlineKind.StrongClose },
  pairing: { kind: "partial", ruleOfThree: true },
};

const underscoreDelimiter: DelimiterConfig = {
  token: InlineKind.UnderscoreRun,
  marker: "_",
  fallbackToken: InlineKind.Delimiter,
  single: { open: InlineKind.EmphasisOpen, close: InlineKind.EmphasisClose },
  double: { open: InlineKind.StrongOpen, close: InlineKind.StrongClose },
  pairing: { kind: "partial", ruleOfThree: true },
  allowIntraword: false,
};

const strikethroughDelimiter: DelimiterConfig = {
  token: InlineKind.TildeRun,
  marker: "~",
  fallbackToken: InlineKind.Delimiter,
  double: { open: InlineKind.StrongOpen, close: InlineKind.StrongClose },
  pairing: { kind: "whole" },
};

export interface StrikethroughOptions {
  singleTilde?: boolean;
}

type Formatting = Delete | Emphasis | Strong;

function createBuildFormatting(type: Formatting["type"]): InlineNodeBuilder {
  return (openToken, closeToken, children, sourceSpan, accumulator) => {
    appendInline(accumulator, { type, children, position: sourceSpan });
  };
}

const buildInlineEmphasis = createBuildFormatting("emphasis");
const buildInlineStrong = createBuildFormatting("strong");
const buildInlineDelete = createBuildFormatting("delete");

const buildInlineStrongOrDelete: InlineNodeBuilder = (
  openToken,
  closeToken,
  children,
  sourceSpan,
  accumulator,
) => {
  const build = accumulator.context.source[sourceSpan.start] === "~"
    ? buildInlineDelete
    : buildInlineStrong;
  build(openToken, closeToken, children, sourceSpan, accumulator);
};

export function feature(strikethroughOptions?: boolean | StrikethroughOptions): SyntaxFeature {
  const delimiters = [asteriskDelimiter, underscoreDelimiter];
  if (strikethroughOptions) {
    delimiters.push(
      typeof strikethroughOptions !== "object" || strikethroughOptions.singleTilde !== false
        ? { ...strikethroughDelimiter, single: strikethroughDelimiter.double }
        : strikethroughDelimiter,
    );
  }

  // Reuse the double-delimiter structure so enabling `~` does not add another semantic rule.
  const buildStrong = strikethroughOptions ? buildInlineStrongOrDelete : buildInlineStrong;

  return {
    inline: {
      lexical: [
        { marker: "*", scan: scanFormatting },
        { marker: "_", scan: scanFormatting },
        { marker: "~", scan: scanFormatting },
      ],
      resolution: { delimiters },
      syntax: [
        { kind: "leaf", token: InlineKind.Delimiter, build: buildInlineText },
        { kind: "leaf", token: InlineKind.TildeRun, build: buildInlineText },
        {
          kind: "pair",
          open: InlineKind.EmphasisOpen,
          close: InlineKind.EmphasisClose,
          build: buildInlineEmphasis,
        },
        {
          kind: "pair",
          open: InlineKind.StrongOpen,
          close: InlineKind.StrongClose,
          build: buildStrong,
        },
      ],
    },
  };
}
