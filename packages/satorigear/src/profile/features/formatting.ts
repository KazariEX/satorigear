import type { Delete, Emphasis, Strong } from "mdast";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { inlineMarkerRunEnd, type InlineScanRule } from "../../inline/lexer.ts";
import { appendInlineToken } from "../../inline/tokens.ts";
import { buildInlineText } from "./text.ts";
import type { DelimiterConfig } from "../../inline/delimiter.ts";
import type { InlineBuildRule } from "../../inline/profile.ts";
import type { SyntaxFeature } from "../types.ts";

type InlinePairBuildRule = Extract<InlineBuildRule, { kind: "pair" }>;

const scanFormatting: InlineScanRule["scan"] = (source, start, tokens) => {
  const code = source.charCodeAt(start);
  const end = inlineMarkerRunEnd(source, start);
  const kind = code === Character.Asterisk
    ? InlineKind.AsteriskRun
    : code === Character.LowLine ? InlineKind.UnderscoreRun : InlineKind.TildeRun;
  appendInlineToken(tokens, kind, start, end);
  return end;
};

function createFormattingPair(
  type: (Emphasis | Strong | Delete)["type"],
  open: InlineKind,
  close: InlineKind,
): InlinePairBuildRule {
  return {
    kind: "pair",
    open,
    close,
    build(openToken, closeToken, sourceSpan, children) {
      return {
        type,
        children,
        position: sourceSpan,
      };
    },
  };
}

const emphasisPair = createFormattingPair("emphasis", InlineKind.EmphasisOpen, InlineKind.EmphasisClose);
const strongPair = createFormattingPair("strong", InlineKind.StrongOpen, InlineKind.StrongClose);
const deletePair = createFormattingPair("delete", InlineKind.DeleteOpen, InlineKind.DeleteClose);

const asteriskDelimiter: DelimiterConfig = {
  token: InlineKind.AsteriskRun,
  single: emphasisPair,
  double: strongPair,
  pairing: { kind: "partial", ruleOfThree: true },
};

const underscoreDelimiter: DelimiterConfig = {
  token: InlineKind.UnderscoreRun,
  single: emphasisPair,
  double: strongPair,
  pairing: { kind: "partial", ruleOfThree: true },
  allowIntraword: false,
};

const strikethroughDelimiter: DelimiterConfig = {
  token: InlineKind.TildeRun,
  double: deletePair,
  pairing: { kind: "whole" },
};

export interface StrikethroughOptions {
  singleTilde?: boolean;
}

export function feature(strikethroughOptions?: boolean | StrikethroughOptions): SyntaxFeature {
  const builds: InlineBuildRule[] = [
    { kind: "leaf", token: InlineKind.AsteriskRun, build: buildInlineText },
    { kind: "leaf", token: InlineKind.UnderscoreRun, build: buildInlineText },
    emphasisPair,
    strongPair,
  ];
  const delimiters = [
    asteriskDelimiter,
    underscoreDelimiter,
  ];
  const scans: InlineScanRule[] = [
    { marker: Character.Asterisk, scan: scanFormatting },
    { marker: Character.LowLine, scan: scanFormatting },
  ];

  if (strikethroughOptions) {
    builds.push(
      { kind: "leaf", token: InlineKind.TildeRun, build: buildInlineText },
      deletePair,
    );
    delimiters.push(
      typeof strikethroughOptions !== "object" || strikethroughOptions.singleTilde !== false
        ? { ...strikethroughDelimiter, single: deletePair }
        : strikethroughDelimiter,
    );
    scans.push({ marker: Character.Tilde, scan: scanFormatting });
  }

  return {
    inline: {
      scan: scans,
      resolve: {
        delimiters,
      },
      build: builds,
    },
  };
}
