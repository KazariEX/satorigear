import type { Delete, Emphasis, Strong } from "mdast";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../inline/kinds.ts";
import { type InlineLexicalRule, inlineMarkerRunEnd } from "../../inline/lexer.ts";
import { appendInlineToken } from "../../inline/tokens.ts";
import { buildInlineText } from "./text.ts";
import type { InlineNodeBuilder } from "../../fragment/inline.ts";
import type { DelimiterConfig } from "../../inline/pairing.ts";
import type { InlineSyntaxDefinition } from "../../inline/profile.ts";
import type { SyntaxFeature } from "../types.ts";

const asteriskDelimiter: DelimiterConfig = {
  token: InlineKind.AsteriskRun,
  marker: Character.Asterisk,
  single: { open: InlineKind.EmphasisOpen, close: InlineKind.EmphasisClose },
  double: { open: InlineKind.StrongOpen, close: InlineKind.StrongClose },
  pairing: { kind: "partial", ruleOfThree: true },
};

const underscoreDelimiter: DelimiterConfig = {
  token: InlineKind.UnderscoreRun,
  marker: Character.LowLine,
  single: { open: InlineKind.EmphasisOpen, close: InlineKind.EmphasisClose },
  double: { open: InlineKind.StrongOpen, close: InlineKind.StrongClose },
  pairing: { kind: "partial", ruleOfThree: true },
  allowIntraword: false,
};

const strikethroughDelimiter: DelimiterConfig = {
  token: InlineKind.TildeRun,
  marker: Character.Tilde,
  double: { open: InlineKind.DeleteOpen, close: InlineKind.DeleteClose },
  pairing: { kind: "whole" },
};

const scanFormatting: InlineLexicalRule["scan"] = (source, start, tokens) => {
  const code = source.charCodeAt(start);
  const end = inlineMarkerRunEnd(source, start);
  const kind = code === Character.Asterisk
    ? InlineKind.AsteriskRun
    : code === Character.LowLine ? InlineKind.UnderscoreRun : InlineKind.TildeRun;
  appendInlineToken(tokens, kind, start, end);
  return end;
};

function createBuildFormatting(type: (Emphasis | Strong | Delete)["type"]): InlineNodeBuilder {
  return (openToken, closeToken, sourceSpan, children) => ({
    type,
    children,
    position: sourceSpan,
  });
}

export interface StrikethroughOptions {
  singleTilde?: boolean;
}

export function feature(strikethroughOptions?: boolean | StrikethroughOptions): SyntaxFeature {
  const delimiters = [
    asteriskDelimiter,
    underscoreDelimiter,
  ];
  const lexical: InlineLexicalRule[] = [
    { marker: Character.Asterisk, scan: scanFormatting },
    { marker: Character.LowLine, scan: scanFormatting },
  ];
  const syntax: InlineSyntaxDefinition[] = [
    { kind: "leaf", token: InlineKind.AsteriskRun, build: buildInlineText },
    { kind: "leaf", token: InlineKind.UnderscoreRun, build: buildInlineText },
    {
      kind: "pair",
      open: InlineKind.EmphasisOpen,
      close: InlineKind.EmphasisClose,
      build: createBuildFormatting("emphasis"),
    },
    {
      kind: "pair",
      open: InlineKind.StrongOpen,
      close: InlineKind.StrongClose,
      build: createBuildFormatting("strong"),
    },
  ];

  if (strikethroughOptions) {
    lexical.push({ marker: Character.Tilde, scan: scanFormatting });
    delimiters.push(
      typeof strikethroughOptions !== "object" || strikethroughOptions.singleTilde !== false
        ? {
          ...strikethroughDelimiter,
          single: strikethroughDelimiter.double,
        }
        : strikethroughDelimiter,
    );
    syntax.push(
      { kind: "leaf", token: InlineKind.TildeRun, build: buildInlineText },
      {
        kind: "pair",
        open: InlineKind.DeleteOpen,
        close: InlineKind.DeleteClose,
        build: createBuildFormatting("delete"),
      },
    );
  }

  return {
    inline: {
      lexical,
      delimiters,
      syntax,
    },
  };
}
