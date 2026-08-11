import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { alt, altPattern, defineGrammar, many, never, noneOf, plus, rule, seq, star, token } from "monogram/api.ts";
import { createLexer } from "monogram/gen-lexer.ts";
import { expect, it } from "vitest";

interface ExternalToken {
  commentBefore: boolean;
  multilineFlowBefore: boolean;
  newlineBefore: boolean;
  offset: number;
  text: string;
  type: string;
}

interface PackedLexerRuntime {
  packedTokenStride: number;
  tokenKind: (type: string) => number;
  tokenizePacked: (source: string) => number[];
}

const LineEnd = altPattern("\r\n", "\r", "\n");
const Newline = token(never());
const HardBreak = token(altPattern(
  seq("\\", LineEnd),
  seq("  ", star(" "), LineEnd),
));
const CodeSpan = token("`", { delimitedSpan: { markers: ["`"], minLength: 1, multiline: true } });
const Text = token(plus(noneOf(" ", "\t", "\n", "\r", "`", "\\")));
const Line = rule(() => [[alt(HardBreak, CodeSpan, Text), many(alt(HardBreak, CodeSpan, Text))]]);
const Document = rule(() => [[Line, many(Newline, Line)]]);
const newlineGrammar = defineGrammar({
  name: "emitted-newline",
  tokens: { HardBreak, CodeSpan, Text, Newline },
  rules: { Document, Line },
  entry: Document,
  newline: { token: "Newline", hardBreak: { token: "HardBreak", minSpaces: 2 } },
});

function packTokens(runtime: PackedLexerRuntime, tokens: readonly ExternalToken[]): number[] {
  return tokens.flatMap((token) => [
    runtime.tokenKind(token.type),
    token.offset,
    token.offset + token.text.length,
    (token.newlineBefore ? 1 : 0) |
      (token.commentBefore ? 2 : 0) |
      (token.multilineFlowBefore ? 4 : 0),
  ]);
}

it("matches the fallback lexer for newline and delimited spans", async () => {
  const directory = await mkdtemp(join(tmpdir(), "satorigear-emitted-lexer-"));
  try {
    const emitter = await import("monogram/emit-parser.ts" as string) as {
      emitJsPackedLexer: (value: typeof newlineGrammar) => string;
    };
    const modulePath = join(directory, "lexer.ts");
    await writeFile(modulePath, `// @ts-nocheck\n${emitter.emitJsPackedLexer(newlineGrammar)}`);
    const runtime = await import(/* @vite-ignore */ pathToFileURL(modulePath).href) as PackedLexerRuntime;
    const fallback = createLexer(newlineGrammar).tokenize;
    const sources = [
      "alpha\nbeta",
      "\n \r\n\t \rword",
      "alpha  \nbeta",
      "alpha\\\r\nbeta",
      "`a\nb`\nword",
      "``a`b``\nword",
      "alpha\u00a0beta\nword",
    ];

    for (const source of sources) {
      expect(runtime.packedTokenStride).toBe(4);
      expect(runtime.tokenizePacked(source)).toEqual(packTokens(runtime, fallback(source)));
    }
  }
  finally {
    await rm(directory, { force: true, recursive: true });
  }
});
