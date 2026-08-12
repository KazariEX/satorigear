import { inlineKindName } from "./kinds.ts";
import {
  inlineTokenEnd,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
  inlineTokenStride,
} from "./tokens.ts";
import type { InlineNodeBuilder } from "../fragment/inline.ts";
import type { InlineSyntaxSchema } from "./profile.ts";

export interface PreparedInlineRegion {
  preparedRoot: number;
  tokens: InlineTokenStream;
}

function leaf(tokenIndex: number): number {
  return ~tokenIndex;
}

// Pair resolution has already made nesting unambiguous; this arena records that semantic tree
// directly instead of asking a second parser to rediscover it.
export class InlineArena {
  #childCounts: number[] = [];
  #childStarts: number[] = [];
  #children: number[] = [];
  #ends: number[] = [];
  #kidCount = 0;
  #nodeCount = 0;
  #builders: (InlineNodeBuilder | undefined)[] = [];
  #schema: InlineSyntaxSchema;
  #scratch: number[][] = [];
  #starts: number[] = [];

  constructor(schema: InlineSyntaxSchema) {
    this.#schema = schema;
  }

  build(regions: readonly PreparedInlineRegion[]): void {
    this.#kidCount = 0;
    this.#nodeCount = 0;

    for (let index = 0; index < regions.length; index++) {
      const region = regions[index];
      const tokens = region.tokens;
      // The root is valid only for this shared arena build; the region retains token ownership.
      region.preparedRoot = buildRoot(
        this,
        this.#schema,
        tokens,
        0,
        tokens.length / inlineTokenStride,
      );
    }
  }

  node(
    build: InlineNodeBuilder | undefined,
    start: number,
    end: number,
    children: readonly number[],
    childCount: number,
  ): number {
    const id = this.#nodeCount++;
    this.#builders[id] = build;
    this.#starts[id] = start;
    this.#ends[id] = end;
    this.#childStarts[id] = this.#kidCount;
    this.#childCounts[id] = childCount;
    for (let index = 0; index < childCount; index++) {
      this.#children[this.#kidCount++] = children[index];
    }
    return id;
  }

  singleNode(
    build: InlineNodeBuilder,
    start: number,
    end: number,
    child: number,
  ): number {
    const id = this.#nodeCount++;
    this.#builders[id] = build;
    this.#starts[id] = start;
    this.#ends[id] = end;
    this.#childStarts[id] = this.#kidCount;
    this.#childCounts[id] = 1;
    this.#children[this.#kidCount++] = child;
    return id;
  }

  scratch(depth: number): number[] {
    // Nodes copy children into the arena before this depth-indexed list is reused.
    return (this.#scratch[depth] ??= []);
  }

  entryEnd(entry: number, tokens: InlineTokenStream): number {
    return entry < 0 ? inlineTokenEnd(tokens, ~entry) : this.#ends[entry];
  }

  entryStart(entry: number, tokens: InlineTokenStream): number {
    return entry < 0 ? inlineTokenStart(tokens, ~entry) : this.#starts[entry];
  }

  childAt(id: number, index: number): number {
    return this.#children[this.#childStarts[id] + index];
  }

  childCount(id: number): number {
    return this.#childCounts[id];
  }

  childRelAt(id: number, index: number, tokens: InlineTokenStream): number {
    const child = this.childAt(id, index);
    return this.entryStart(child, tokens) - this.#starts[id];
  }

  leafToken(entry: number): number {
    return ~entry;
  }

  leafTokenType(entry: number, tokens: InlineTokenStream): string {
    return inlineKindName(inlineTokenKind(tokens, ~entry));
  }

  lenOf(id: number): number {
    return this.#ends[id] - this.#starts[id];
  }

  builderOf(id: number): InlineNodeBuilder | undefined {
    return this.#builders[id];
  }
}

interface ParseResult {
  childCount: number;
  children: number[];
  next: number;
}

function semanticNode(
  arena: InlineArena,
  schema: InlineSyntaxSchema,
  tokens: InlineTokenStream,
  index: number,
  end: number,
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
        scratchDepth + 1,
      );
      if (
        content.next >= end ||
        inlineTokenKind(tokens, content.next) !== container.closeKind
      ) {
        throw new Error(`Resolved inline stream did not close token kind ${kind}`);
      }
      for (let child = 0; child < content.childCount; child++) {
        children.push(content.children[child]);
      }
      children.push(leaf(content.next));
      next = content.next + 1;
    }
    return {
      id: arena.node(
        container.build,
        inlineTokenStart(tokens, index),
        inlineTokenEnd(tokens, next - 1),
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
    scratchDepth + 1,
  );
  if (
    content.next >= end ||
    inlineTokenKind(tokens, content.next) !== pair.closeKind
  ) {
    throw new Error(`Resolved inline stream did not close token kind ${kind}`);
  }
  const children = [leaf(index)];
  for (let child = 0; child < content.childCount; child++) {
    children.push(content.children[child]);
  }
  children.push(leaf(content.next));
  return {
    id: arena.node(
      pair.build,
      inlineTokenStart(tokens, index),
      inlineTokenEnd(tokens, content.next),
      children,
      children.length,
    ),
    next: content.next + 1,
  };
}

function parseItems(
  arena: InlineArena,
  schema: InlineSyntaxSchema,
  tokens: InlineTokenStream,
  start: number,
  end: number,
  closeKind: number | undefined,
  scratchDepth = 0,
): ParseResult {
  const children = arena.scratch(scratchDepth);
  let childCount = 0;
  let index = start;
  while (index < end) {
    const kind = inlineTokenKind(tokens, index);
    if (kind === closeKind) {
      break;
    }

    const semantic = semanticNode(arena, schema, tokens, index, end, scratchDepth);
    let item: number;
    if (semantic) {
      item = semantic.id;
      index = semantic.next;
    }
    else {
      const fallbackBuilder = schema.fallbackBuilderByKind[kind];
      item = fallbackBuilder === void 0
        ? leaf(index)
        : arena.singleNode(
          fallbackBuilder,
          inlineTokenStart(tokens, index),
          inlineTokenEnd(tokens, index),
          leaf(index),
        );
      index++;
    }
    children[childCount++] = item;
  }
  return { childCount, children, next: index };
}

function buildRoot(
  arena: InlineArena,
  schema: InlineSyntaxSchema,
  tokens: InlineTokenStream,
  start: number,
  end: number,
): number {
  const content = parseItems(arena, schema, tokens, start, end, void 0);
  if (content.childCount === 0) {
    return arena.node(void 0, 0, 0, content.children, 0);
  }
  const first = content.children[0];
  const last = content.children[content.childCount - 1];
  return arena.node(
    void 0,
    arena.entryStart(first, tokens),
    arena.entryEnd(last, tokens),
    content.children,
    content.childCount,
  );
}
