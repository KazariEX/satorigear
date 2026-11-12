import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { inlineMarkerRunEnd, type InlineScanRule } from "../../inline/tokenize.ts";
import { appendInlineToken } from "../../inline/tokens.ts";
import type { DelimiterConfig } from "../../inline/delimiter.ts";
import type { InlineBuildRule } from "../../inline/profile.ts";
import type { SyntaxFeature } from "../types.ts";

interface Formatting {
  delimiter: DelimiterConfig;
  scanner: InlineScanRule;
  builder: InlineBuildRule;
}

function createFormatting(
  type: "emphasis" | "strong" | "delete",
  marker: Character,
  buildToken: InlineKind,
  delimiter: DelimiterConfig,
): Formatting {
  return {
    delimiter,
    scanner: {
      marker,
      scan(source, start, tokens) {
        const end = inlineMarkerRunEnd(source, start);
        appendInlineToken(tokens, delimiter.token, start, end);
        return end;
      },
    },
    builder: {
      kind: "pair",
      token: buildToken,
      build: (openToken, closeToken, position, children) => ({
        type,
        children,
        position,
      }),
    },
  };
}

const formattingAsterisk = createFormatting("emphasis", Character.Asterisk, InlineKind.EmphasisOpen, {
  token: InlineKind.AsteriskRun,
  single: {
    open: InlineKind.EmphasisOpen,
    close: InlineKind.EmphasisClose,
  },
  double: {
    open: InlineKind.StrongOpen,
    close: InlineKind.StrongClose,
  },
  pairing: {
    kind: "partial",
    ruleOfThree: true,
  },
});

const formattingUnderscore = createFormatting("strong", Character.LowLine, InlineKind.StrongOpen, {
  token: InlineKind.UnderscoreRun,
  single: {
    open: InlineKind.EmphasisOpen,
    close: InlineKind.EmphasisClose,
  },
  double: {
    open: InlineKind.StrongOpen,
    close: InlineKind.StrongClose,
  },
  pairing: {
    kind: "partial",
    ruleOfThree: true,
  },
  allowIntraword: false,
});

const formattingStrikethrough = createFormatting("delete", Character.Tilde, InlineKind.DeleteOpen, {
  token: InlineKind.TildeRun,
  double: {
    open: InlineKind.DeleteOpen,
    close: InlineKind.DeleteClose,
  },
  pairing: {
    kind: "whole",
  },
});

export interface StrikethroughOptions {
  singleTilde?: boolean;
}

export function feature(strikethroughOptions?: boolean | StrikethroughOptions): SyntaxFeature {
  const scans = [
    formattingAsterisk.scanner,
    formattingUnderscore.scanner,
  ];
  const delimiters = [
    formattingAsterisk.delimiter,
    formattingUnderscore.delimiter,
  ];
  const builds = [
    formattingAsterisk.builder,
    formattingUnderscore.builder,
  ];

  if (strikethroughOptions) {
    scans.push(formattingStrikethrough.scanner);
    builds.push(formattingStrikethrough.builder);
    delimiters.push(
      typeof strikethroughOptions !== "object" || strikethroughOptions.singleTilde !== false
        ? {
          single: formattingStrikethrough.delimiter.double,
          ...formattingStrikethrough.delimiter,
        }
        : formattingStrikethrough.delimiter,
    );
  }

  return {
    inline: {
      scans,
      delimiters,
      builds,
    },
  };
}
