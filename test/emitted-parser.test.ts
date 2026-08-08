import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { defineGrammar, notLeftLeaf, plus, range, rule, token } from "monogram/api.ts";
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

it("isolates fallback token text between emitted parser documents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "satorigear-emitted-parser-"));
  try {
    // Keep the generator's wider source graph outside this project's typecheck.
    const emitter = await import("monogram/emit-parser.ts" as string) as {
      emitJsParser: (value: typeof grammar, lexer: null) => string;
    };
    const modulePath = join(directory, "parser.ts");
    await writeFile(modulePath, `// @ts-nocheck\n${emitter.emitJsParser(grammar, null)}`);
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
