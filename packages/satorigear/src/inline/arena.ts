import { inlineKindName } from "./kinds.ts";
import {
  inlineTokenEnd,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
  inlineTokenStride,
} from "./tokens.ts";
import type { InlineRuleProjector } from "../mdast.ts";
import type { InlineSyntaxSchema } from "./profile.ts";

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
  #packedTokens: number[] = [];
  #projects: (InlineRuleProjector | undefined)[] = [];
  #schema: InlineSyntaxSchema;
  #scratch: number[][] = [];
  #starts: number[] = [];
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
      roots[index] = buildRoot(this, this.#schema, this.#tokens, tokenStart, tokenEnd);
      tokenStart = tokenEnd;
    }
  }

  node(
    project: InlineRuleProjector | undefined,
    start: number,
    end: number,
    children: readonly number[],
    childCount: number,
  ): number {
    const id = this.#nodeCount++;
    this.#projects[id] = project;
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
    project: InlineRuleProjector,
    start: number,
    end: number,
    child: number,
  ): number {
    const id = this.#nodeCount++;
    this.#projects[id] = project;
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

  entryEnd(entry: number): number {
    return entry < 0 ? inlineTokenEnd(this.#tokens, ~entry) : this.#ends[entry];
  }

  entryStart(entry: number): number {
    return entry < 0 ? inlineTokenStart(this.#tokens, ~entry) : this.#starts[entry];
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

  leafToken(entry: number): number {
    return ~entry;
  }

  leafTokenType(entry: number): string {
    return inlineKindName(inlineTokenKind(this.#tokens, ~entry));
  }

  lenOf(id: number): number {
    return this.#ends[id] - this.#starts[id];
  }

  projectOf(id: number): InlineRuleProjector | undefined {
    return this.#projects[id];
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
        container.project,
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
      pair.project,
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
      const fallbackProject = schema.fallbackProjectByKind[kind];
      item = fallbackProject === void 0
        ? leaf(index)
        : arena.singleNode(
          fallbackProject,
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
    arena.entryStart(first),
    arena.entryEnd(last),
    content.children,
    content.childCount,
  );
}
