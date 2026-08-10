import {
  inlineKind,
  inlineTokenEnd,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
  inlineTokenStride,
} from "./tokens.ts";
import type { SyntaxArena } from "../syntax-protocol.ts";

export type InlineStructureRegistration =
  | {
    kind: "container";
    close: string;
    contentOpen: string;
    linkRule?: string;
    rule: string;
    token: string;
  }
  | {
    kind: "fallback";
    rule: string;
    tokens: readonly string[];
  }
  | {
    kind: "pair";
    close: string;
    entersLink?: true;
    linkRule?: string;
    open: string;
    rule: string;
  };

interface InlinePair {
  closeKind: number;
  entersLink: boolean;
  linkRuleId: number;
  ruleId: number;
}

interface InlineContainer {
  closeKind: number;
  contentOpenKind: number;
  linkRuleId: number;
  ruleId: number;
}

export interface InlineSyntaxSchema {
  containerByKind: readonly (InlineContainer | undefined)[];
  fallbackRuleByKind: readonly (number | undefined)[];
  inlineLineRuleId: number;
  inlineLinesRuleId: number;
  inlineRuleId: number;
  linkContentRuleId: number;
  newlineKind: number;
  pairByOpenKind: readonly (InlinePair | undefined)[];
  ruleNames: readonly string[];
  tokenNames: readonly (string | undefined)[];
}

export function compileInlineSyntax(
  registrations: readonly InlineStructureRegistration[],
  tokenNames: readonly (string | undefined)[],
): InlineSyntaxSchema {
  const compiledTokenNames = [...tokenNames];
  const ruleNames: string[] = [];
  const ruleIds = new Map<string, number>();
  const ruleId = (name: string): number => {
    let id = ruleIds.get(name);
    if (id === void 0) {
      id = ruleNames.length;
      ruleIds.set(name, id);
      ruleNames.push(name);
    }
    return id;
  };
  const containerByKind: (InlineContainer | undefined)[] = [];
  const fallbackRuleByKind: (number | undefined)[] = [];
  const pairByOpenKind: (InlinePair | undefined)[] = [];

  for (const registration of registrations) {
    const registrationRuleId = ruleId(registration.rule);
    if (registration.kind === "fallback") {
      for (const token of registration.tokens) {
        fallbackRuleByKind[inlineKind(token)] = registrationRuleId;
      }
      continue;
    }

    const linkRuleId = registration.linkRule === void 0
      ? registrationRuleId
      : ruleId(registration.linkRule);
    if (registration.kind === "container") {
      containerByKind[inlineKind(registration.token)] = {
        closeKind: inlineKind(registration.close),
        contentOpenKind: inlineKind(registration.contentOpen),
        linkRuleId,
        ruleId: registrationRuleId,
      };
      continue;
    }

    pairByOpenKind[inlineKind(registration.open)] = {
      closeKind: inlineKind(registration.close),
      entersLink: registration.entersLink === true,
      linkRuleId,
      ruleId: registrationRuleId,
    };
  }

  const newlineKind = inlineKind("Newline");
  compiledTokenNames[newlineKind] = "Newline";
  return {
    containerByKind,
    fallbackRuleByKind,
    inlineLineRuleId: ruleId("InlineLine"),
    inlineLinesRuleId: ruleId("InlineLines"),
    inlineRuleId: ruleId("Inline"),
    linkContentRuleId: ruleId("LinkContent"),
    newlineKind,
    pairByOpenKind,
    ruleNames,
    tokenNames: compiledTokenNames,
  };
}

function leaf(tokenIndex: number): number {
  return ~tokenIndex;
}

// Pair resolution has already made nesting unambiguous; this arena records that semantic tree
// directly instead of asking a second parser to rediscover it.
export class InlineSyntaxArena implements SyntaxArena {
  #childCounts: number[] = [];
  #childStarts: number[] = [];
  #children: number[] = [];
  #ends: number[] = [];
  #kidCount = 0;
  #nodeCount = 0;
  #packedTokens: number[] = [];
  #ruleIds: number[] = [];
  #schema: InlineSyntaxSchema;
  #scratch: number[][] = [];
  #starts: number[] = [];
  #tokenBases: number[] = [];
  #tokens: InlineTokenStream = [];

  constructor(schema: InlineSyntaxSchema) {
    this.#schema = schema;
  }

  build(segments: readonly InlineTokenStream[], roots: number[]): void {
    // Batching removes per-region parser startup; token bases retain each region's local coordinates.
    let fieldCount = 0;
    for (const segment of segments) {
      for (let field = 0; field < segment.length; field++) {
        this.#packedTokens[fieldCount++] = segment[field];
      }
    }
    this.#tokens = this.#packedTokens;
    this.#kidCount = 0;
    this.#nodeCount = 0;

    let tokenStart = 0;
    for (let index = 0; index < segments.length; index++) {
      const tokenEnd = tokenStart + segments[index].length / inlineTokenStride;
      roots[index] = buildLines(this, this.#schema, this.#tokens, tokenStart, tokenEnd);
      tokenStart = tokenEnd;
    }
  }

  node(
    ruleId: number,
    start: number,
    end: number,
    tokenBase: number,
    children: readonly number[],
    childCount: number,
  ): number {
    const id = this.#nodeCount++;
    this.#ruleIds[id] = ruleId;
    this.#starts[id] = start;
    this.#ends[id] = end;
    this.#tokenBases[id] = tokenBase;
    this.#childStarts[id] = this.#kidCount;
    this.#childCounts[id] = childCount;
    for (let index = 0; index < childCount; index++) {
      this.#children[this.#kidCount++] = children[index];
    }
    return id;
  }

  singleNode(
    ruleId: number,
    start: number,
    end: number,
    tokenBase: number,
    child: number,
  ): number {
    const id = this.#nodeCount++;
    this.#ruleIds[id] = ruleId;
    this.#starts[id] = start;
    this.#ends[id] = end;
    this.#tokenBases[id] = tokenBase;
    this.#childStarts[id] = this.#kidCount;
    this.#childCounts[id] = 1;
    this.#children[this.#kidCount++] = child;
    return id;
  }

  scratch(depth: number): number[] {
    // Nodes copy children into the arena before this depth-indexed list is reused.
    return (this.#scratch[depth] ??= []);
  }

  entryEnd(entry: number): number {
    return entry < 0 ? inlineTokenEnd(this.#tokens, ~entry) : this.#ends[entry];
  }

  entryStart(entry: number): number {
    return entry < 0 ? inlineTokenStart(this.#tokens, ~entry) : this.#starts[entry];
  }

  entryTokenBase(entry: number): number {
    return entry < 0 ? ~entry : this.#tokenBases[entry];
  }

  childAt(id: number, index: number): number {
    return this.#children[this.#childStarts[id] + index];
  }

  childCount(id: number): number {
    return this.#childCounts[id];
  }

  childRelAt(id: number, index: number): number {
    const child = this.childAt(id, index);
    return this.entryStart(child) - this.#starts[id];
  }

  childTokRelAt(id: number, index: number): number {
    return this.entryTokenBase(this.childAt(id, index)) - this.#tokenBases[id];
  }

  leafToken(entry: number): number {
    return ~entry;
  }

  leafTokenType(entry: number): string {
    const kind = inlineTokenKind(this.#tokens, ~entry);
    const name = this.#schema.tokenNames[kind];
    if (name === void 0) {
      throw new Error(`Unknown inline token kind ${kind}`);
    }
    return name;
  }

  lenOf(id: number): number {
    return this.#ends[id] - this.#starts[id];
  }

  ruleNameOf(id: number): string {
    return this.#schema.ruleNames[this.#ruleIds[id]];
  }
}

interface ParseResult {
  childCount: number;
  children: number[];
  next: number;
}

function startToken(arena: InlineSyntaxArena, entry: number): number {
  if (entry < 0) {
    return ~entry;
  }
  const child = arena.childAt(entry, 0);
  return child < 0 ? arena.leafToken(child) : startToken(arena, child);
}

function semanticNode(
  arena: InlineSyntaxArena,
  schema: InlineSyntaxSchema,
  tokens: InlineTokenStream,
  index: number,
  end: number,
  inLink: boolean,
  scratchDepth: number,
): { id: number; next: number } | undefined {
  const kind = inlineTokenKind(tokens, index);
  const container = schema.containerByKind[kind];
  if (container) {
    const children = [leaf(index)];
    let next = index + 1;
    if (
      next < end &&
      inlineTokenKind(tokens, next) === container.contentOpenKind
    ) {
      children.push(leaf(next));
      const content = parseItems(
        arena,
        schema,
        tokens,
        next + 1,
        end,
        container.closeKind,
        inLink,
        false,
        scratchDepth + 1,
      );
      if (
        content.next >= end ||
        inlineTokenKind(tokens, content.next) !== container.closeKind
      ) {
        const name = schema.tokenNames[kind] ?? "inline token";
        throw new Error(`Resolved inline stream did not close ${name}`);
      }
      for (let child = 0; child < content.childCount; child++) {
        children.push(content.children[child]);
      }
      children.push(leaf(content.next));
      next = content.next + 1;
    }
    return {
      id: arena.node(
        inLink ? container.linkRuleId : container.ruleId,
        inlineTokenStart(tokens, index),
        inlineTokenEnd(tokens, next - 1),
        index,
        children,
        children.length,
      ),
      next,
    };
  }

  const pair = schema.pairByOpenKind[kind];
  if (!pair) {
    return;
  }
  const content = parseItems(
    arena,
    schema,
    tokens,
    index + 1,
    end,
    pair.closeKind,
    inLink || pair.entersLink,
    false,
    scratchDepth + 1,
  );
  if (
    content.next >= end ||
    inlineTokenKind(tokens, content.next) !== pair.closeKind
  ) {
    const name = schema.tokenNames[kind] ?? "inline token";
    throw new Error(`Resolved inline stream did not close ${name}`);
  }
  const children = [leaf(index)];
  for (let child = 0; child < content.childCount; child++) {
    children.push(content.children[child]);
  }
  children.push(leaf(content.next));
  return {
    id: arena.node(
      inLink ? pair.linkRuleId : pair.ruleId,
      inlineTokenStart(tokens, index),
      inlineTokenEnd(tokens, content.next),
      index,
      children,
      children.length,
    ),
    next: content.next + 1,
  };
}

function parseItems(
  arena: InlineSyntaxArena,
  schema: InlineSyntaxSchema,
  tokens: InlineTokenStream,
  start: number,
  end: number,
  closeKind: number | undefined,
  inLink: boolean,
  stopAtNewline = false,
  scratchDepth = 0,
): ParseResult {
  const children = arena.scratch(scratchDepth);
  let childCount = 0;
  let index = start;
  while (index < end) {
    const kind = inlineTokenKind(tokens, index);
    if (kind === closeKind || (stopAtNewline && kind === schema.newlineKind)) {
      break;
    }
    if (kind === schema.newlineKind) {
      children[childCount++] = leaf(index++);
      continue;
    }

    const semantic = semanticNode(arena, schema, tokens, index, end, inLink, scratchDepth);
    let item: number;
    if (semantic) {
      item = semantic.id;
      index = semantic.next;
    }
    else {
      const fallbackRule = schema.fallbackRuleByKind[kind];
      item = fallbackRule === void 0
        ? leaf(index)
        : arena.singleNode(
          fallbackRule,
          inlineTokenStart(tokens, index),
          inlineTokenEnd(tokens, index),
          index,
          leaf(index),
        );
      index++;
    }
    const tokenBase = startToken(arena, item);
    children[childCount++] = arena.singleNode(
      inLink ? schema.linkContentRuleId : schema.inlineRuleId,
      arena.entryStart(item),
      arena.entryEnd(item),
      tokenBase,
      item,
    );
  }
  return { childCount, children, next: index };
}

function buildLines(
  arena: InlineSyntaxArena,
  schema: InlineSyntaxSchema,
  tokens: InlineTokenStream,
  start: number,
  end: number,
): number {
  const children = arena.scratch(0);
  let childCount = 0;
  let index = start;
  while (index < end) {
    const content = parseItems(arena, schema, tokens, index, end, void 0, false, true, 1);
    if (content.childCount > 0) {
      const first = content.children[0];
      const last = content.children[content.childCount - 1];
      children[childCount++] = arena.node(
        schema.inlineLineRuleId,
        arena.entryStart(first),
        arena.entryEnd(last),
        startToken(arena, first),
        content.children,
        content.childCount,
      );
    }
    index = content.next;
    if (index < end && inlineTokenKind(tokens, index) === schema.newlineKind) {
      children[childCount++] = leaf(index++);
    }
  }
  if (childCount === 0) {
    return arena.node(schema.inlineLinesRuleId, 0, 0, start, children, 0);
  }
  const first = children[0];
  const last = children[childCount - 1];
  return arena.node(
    schema.inlineLinesRuleId,
    arena.entryStart(first),
    arena.entryEnd(last),
    startToken(arena, first),
    children,
    childCount,
  );
}
