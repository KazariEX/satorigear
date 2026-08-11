import type { CstGrammar, RuleDecl, RuleExpr } from "monogram/types.ts";

interface FrameSpec {
  close: string;
  rule: string;
  wrapsBlock: boolean;
}

interface BlockSyntaxSchema {
  entryRule: string;
  frameByOpen: Record<string, FrameSpec>;
  groupedRuleByToken: Record<string, string>;
  ruleByLeaf: Record<string, string>;
  wrapperRule: string;
}

function fail(message: string): never {
  throw new Error(`Cannot emit block syntax schema: ${message}`);
}

function referencedNames(expression: RuleExpr): string[] | undefined {
  if (expression.type === "ref") {
    return [expression.name];
  }
  if (expression.type === "alt" && expression.items.every((item) => item.type === "ref")) {
    return expression.items.map((item) => item.name);
  }
}

function ruleNamed(rules: ReadonlyMap<string, RuleDecl>, name: string): RuleDecl {
  return rules.get(name) ?? fail(`unknown rule ${name}`);
}

export function emitBlockSyntaxSchema(grammar: CstGrammar): string {
  // The scanner already validates concrete syntax. Compile only the grammar's structural
  // leaf/frame/group shapes so the runtime can build its semantic arena without a second parser.
  const tokens = new Set(grammar.tokens.map((token) => token.name));
  const rules = new Map(grammar.rules.map((rule) => [rule.name, rule]));
  const entry = grammar.rules.at(-1) ?? fail("grammar has no entry rule");
  const entryBody = entry.body;
  if (
    entryBody.type !== "quantifier" ||
    entryBody.body.type !== "ref" ||
    entryBody.kind !== "*"
  ) {
    fail(`entry rule ${entry.name} must contain zero or more wrapper rules`);
  }

  const wrapper = ruleNamed(rules, entryBody.body.name);
  const wrappedRules = referencedNames(wrapper.body);
  if (wrappedRules === void 0 || wrappedRules.some((name) => !rules.has(name))) {
    fail(`wrapper rule ${wrapper.name} must be an alternative of rules`);
  }
  const wrapped = new Set(wrappedRules);
  const schema: BlockSyntaxSchema = {
    entryRule: entry.name,
    frameByOpen: {},
    groupedRuleByToken: {},
    ruleByLeaf: {},
    wrapperRule: wrapper.name,
  };

  for (const rule of grammar.rules) {
    if (rule === entry || rule === wrapper) {
      continue;
    }

    if (rule.body.type === "ref" && tokens.has(rule.body.name)) {
      schema.ruleByLeaf[rule.body.name] = rule.name;
      continue;
    }

    if (rule.body.type === "seq") {
      const opens = referencedNames(rule.body.items[0]);
      const close = rule.body.items.at(-1);
      if (
        opens === void 0 ||
        opens.some((name) => !tokens.has(name)) ||
        close?.type !== "ref" ||
        !tokens.has(close.name)
      ) {
        fail(`framed rule ${rule.name} must start and end with tokens`);
      }
      for (const open of opens) {
        schema.frameByOpen[open] = {
          close: close.name,
          rule: rule.name,
          wrapsBlock: wrapped.has(rule.name),
        };
      }
      continue;
    }

    if (rule.body.type === "quantifier") {
      const members = referencedNames(rule.body.body);
      if (
        rule.body.kind !== "+" ||
        members === void 0 ||
        members.some((name) => !tokens.has(name))
      ) {
        fail(`grouped rule ${rule.name} must contain one or more token alternatives`);
      }
      for (const member of members) {
        schema.groupedRuleByToken[member] = rule.name;
      }
      continue;
    }

    fail(`rule ${rule.name} has an unsupported structural shape`);
  }

  return `export interface BlockSyntaxFrame {\n  close: string;\n  rule: string;\n  wrapsBlock: boolean;\n}\n\nexport interface BlockSyntaxSchema {\n  entryRule: string;\n  frameByOpen: Readonly<Record<string, BlockSyntaxFrame | undefined>>;\n  groupedRuleByToken: Readonly<Record<string, string | undefined>>;\n  ruleByLeaf: Readonly<Record<string, string | undefined>>;\n  wrapperRule: string;\n}\n\nexport const blockSyntaxSchema: BlockSyntaxSchema = ${JSON.stringify(schema, void 0, 2)};\n`;
}
