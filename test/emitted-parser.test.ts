import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { alt, altPattern, defineGrammar, many, never, noneOf, notLeftLeaf, plus, range, rule, seq, star, token } from "monogram/api.ts";
import { createLexer } from "monogram/gen-lexer.ts";
import { expect, it } from "vitest";

interface Diagnostic {
  end: number;
  message: string;
  offset: number;
}

interface ExternalToken {
  commentBefore: boolean;
  multilineFlowBefore: boolean;
  newlineBefore: boolean;
  offset: number;
  text: string;
  type: string;
}

interface Handle {
  errors: Diagnostic[];
  root: number;
}

interface Parser {
  editTokens: (
    handle: Handle,
    edits: readonly { end: number; start: number; text: string }[],
    change: { oldEnd: number; oldStart: number; tokens: readonly ExternalToken[] },
  ) => void;
  parseTokens: (source: string, tokens: readonly ExternalToken[]) => Handle;
  tree: { ruleNameOf: (id: number) => string };
}

interface Runtime {
  __setArenaBudget: (factor: number, minimum: number) => void;
  createParser: () => Parser;
}

interface LexerRuntime {
  tokenize: (source: string) => ExternalToken[];
}

const Word = token(plus(range("a", "z")));
const Expr = rule((self) => [
  Word,
  [self, "-", Word],
  [notLeftLeaf("blocked"), self, ".", Word],
]);
const grammar = defineGrammar({
  name: "document-token-text",
  tokens: { Word },
  rules: { Expr },
  entry: Expr,
});

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

function externalToken(type: string, text: string, offset: number): ExternalToken {
  return {
    commentBefore: false,
    multilineFlowBefore: false,
    newlineBefore: false,
    offset,
    text,
    type,
  };
}

function expressionTokens(head: string, connector: string, tail: string): ExternalToken[] {
  return [
    externalToken("Word", head, 0),
    externalToken("", connector, head.length),
    externalToken("Word", tail, head.length + 1),
  ];
}

function outcome(parser: Parser, handle: Handle): unknown {
  return {
    diagnostics: handle.errors,
    root: parser.tree.ruleNameOf(handle.root),
  };
}

function tokenShape(token: ExternalToken): ExternalToken {
  return {
    commentBefore: token.commentBefore,
    multilineFlowBefore: token.multilineFlowBefore,
    newlineBefore: token.newlineBefore,
    offset: token.offset,
    text: token.text,
    type: token.type,
  };
}

it("matches the fallback lexer for newline and delimited spans", async () => {
  const directory = await mkdtemp(join(tmpdir(), "satorigear-emitted-lexer-"));
  try {
    const emitter = await import("monogram/emit-parser.ts" as string) as {
      emitJsLexer: (value: typeof newlineGrammar) => string | null;
      emitJsParser: (value: typeof newlineGrammar, lexer: string) => string;
    };
    const lexer = emitter.emitJsLexer(newlineGrammar);
    expect(lexer).not.toBeNull();

    const modulePath = join(directory, "parser.ts");
    await writeFile(modulePath, `// @ts-nocheck\n${emitter.emitJsParser(newlineGrammar, lexer!)}`);
    const runtime = await import(/* @vite-ignore */ pathToFileURL(modulePath).href) as LexerRuntime;
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
      expect(runtime.tokenize(source).map(tokenShape)).toEqual(fallback(source).map(tokenShape));
    }
  }
  finally {
    await rm(directory, { force: true, recursive: true });
  }
});

it("isolates SOA parser documents during external token edits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "satorigear-emitted-parser-"));
  try {
    // Keep the generator's wider source graph outside this project's typecheck.
    const emitter = await import("monogram/emit-parser.ts" as string) as {
      emitJsLexer: (value: typeof grammar) => string | null;
      emitJsParser: (value: typeof grammar, lexer: string) => string;
    };
    const lexer = emitter.emitJsLexer(grammar);
    expect(lexer).not.toBeNull();
    if (lexer === null) {
      throw new Error("Expected the document test grammar to use the emitted lexer");
    }
    const modulePath = join(directory, "parser.ts");
    await writeFile(modulePath, `// @ts-nocheck\n${emitter.emitJsParser(grammar, lexer)}`);
    const runtime = await import(/* @vite-ignore */ pathToFileURL(modulePath).href) as Runtime;

    const parserA = runtime.createParser();
    const parserB = runtime.createParser();
    const handleA = parserA.parseTokens("allowed-x", expressionTokens("allowed", "-", "x"));
    parserB.parseTokens("blocked-y", expressionTokens("blocked", "-", "y"));

    // Make the edit re-evaluate the text-sensitive continuation instead of adopting it.
    runtime.__setArenaBudget(0, 0);
    parserA.editTokens(
      handleA,
      [{ start: 7, end: 8, text: "." }],
      { oldStart: 1, oldEnd: 2, tokens: [externalToken("", ".", 7)] },
    );

    const fresh = runtime.createParser();
    const freshHandle = fresh.parseTokens("allowed.x", expressionTokens("allowed", ".", "x"));
    expect(outcome(parserA, handleA)).toEqual(outcome(fresh, freshHandle));
  }
  finally {
    await rm(directory, { force: true, recursive: true });
  }
});
