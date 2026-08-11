import { type BlockToken, type BlockTokenChange, tokenEnd, tokenStart } from "./tokens.ts";
import type { BlockSyntaxFrame, BlockSyntaxSchema } from "./profile.ts";

export interface BlockSyntaxView {
  readonly arena: BlockArena;
  readonly blockHandles: readonly BlockHandle[];
  readonly root: {
    id: number;
    offset: number;
    tokenBase: number;
  };
  tokenAt: (index: number) => BlockToken;
}

// Object identity remains stable for unchanged top-level blocks while released numeric IDs may be reused.
export interface BlockHandle {
  readonly id: number;
}

export interface BlockArenaChange {
  // Arena surgery replaces old [oldStart, oldEnd) with new [oldStart, newEnd).
  readonly newEnd: number;
  readonly oldEnd: number;
  readonly oldStart: number;
}

interface BlockRecord extends BlockHandle {
  tokenEnd: number;
  tokenStart: number;
}

interface Frame extends BlockSyntaxFrame {
  children: number[];
}

interface FreeEdgeRange {
  count: number;
  start: number;
}

function leaf(tokenIndex: number): number {
  return ~tokenIndex;
}

// Relative edges make unchanged top-level trees independent of later source and token shifts.
// The workspace reclaims ranges across edits and retains array capacity across one-shot documents.
export class BlockArena {
  #blockRecords: BlockRecord[] = [];
  #buildEnds: number[] = [];
  #buildStarts: number[] = [];
  #buildTokenEnds: number[] = [];
  #buildTokenStarts: number[] = [];
  #edgeCounts: number[] = [0];
  #edgeLength = 0;
  #edges: number[] = [];
  #edgeStarts: number[] = [0];
  #freeEdges: FreeEdgeRange[] = [];
  #freeIds: number[] = [];
  #blockNodes: boolean[] = [false];
  #lengths: number[] = [0];
  #nodeCount = 1;
  #releaseStack: number[] = [];
  #rules: string[];
  #schema: BlockSyntaxSchema;
  #tokens: readonly BlockToken[] = [];
  root = 0;

  constructor(schema: BlockSyntaxSchema) {
    this.#rules = [schema.entryRule];
    this.#schema = schema;
  }

  build(tokens: readonly BlockToken[]): void {
    // One-shot parses reuse array capacity, but no node identity survives across documents.
    this.#edgeLength = 0;
    this.#freeEdges.length = 0;
    this.#freeIds.length = 0;
    this.#nodeCount = 1;
    this.#tokens = tokens;
    this.#blockRecords = this.#buildRange(0, tokens.length);
    this.#rebuildRoot();
  }

  view(): BlockSyntaxView {
    return {
      arena: this,
      blockHandles: this.#blockRecords,
      root: {
        id: this.root,
        offset: this.#tokens[0] ? tokenStart(this.#tokens[0]) : 0,
        tokenBase: 0,
      },
      tokenAt: (index) => {
        const token = this.#tokens[index];
        if (!token) {
          throw new Error("block arena returned a leaf outside its token stream");
        }
        return token;
      },
    };
  }

  update(tokens: readonly BlockToken[], change: BlockTokenChange): BlockArenaChange {
    const previous = this.#blockRecords;
    // Token damage can begin inside a block, so widen it to complete top-level records.
    let prefixEnd = 0;
    while (prefixEnd < previous.length && previous[prefixEnd].tokenEnd <= change.oldStart) {
      prefixEnd++;
    }
    let suffixStart = prefixEnd;
    while (suffixStart < previous.length && previous[suffixStart].tokenStart < change.oldEnd) {
      suffixStart++;
    }

    const tokenDelta = change.tokens.length - (change.oldEnd - change.oldStart);
    const buildStart = previous[prefixEnd - 1]?.tokenEnd ?? 0;
    const oldSuffixTokenStart = previous[suffixStart]?.tokenStart;
    const buildEnd = oldSuffixTokenStart === void 0 ? tokens.length : oldSuffixTokenStart + tokenDelta;
    this.#releaseEdges(this.root);
    for (let index = prefixEnd; index < suffixStart; index++) {
      this.#release(previous[index].id);
    }
    this.#coalesceFreeEdges();

    this.#tokens = tokens;
    const changed = this.#buildRange(buildStart, buildEnd);
    const suffix = previous.slice(suffixStart);
    if (tokenDelta !== 0) {
      for (const block of suffix) {
        block.tokenStart += tokenDelta;
        block.tokenEnd += tokenDelta;
      }
    }
    this.#blockRecords = [
      ...previous.slice(0, prefixEnd),
      ...changed,
      ...suffix,
    ];
    this.#rebuildRoot();
    return {
      newEnd: prefixEnd + changed.length,
      oldEnd: suffixStart,
      oldStart: prefixEnd,
    };
  }

  #allocate(rule: string, children: readonly number[], block = false): number {
    const id = this.#freeIds.pop() ?? this.#nodeCount++;
    const first = children[0];
    const last = children.at(-1);
    const start = first === void 0 ? 0 : this.#entryStart(first);
    const end = last === void 0 ? start : this.#entryEnd(last);
    const tokenBase = first === void 0 ? 0 : this.#entryTokenStart(first);
    const tokenLimit = last === void 0 ? tokenBase : this.#entryTokenEnd(last);
    const edgeStart = this.#allocateEdges(children.length);
    this.#edgeStarts[id] = edgeStart;
    this.#edgeCounts[id] = children.length;
    for (let index = 0; index < children.length; index++) {
      const entry = children[index];
      const edge = (edgeStart + index) * 3;
      this.#edges[edge] = entry < 0 ? leaf((~entry) - tokenBase) : entry;
      this.#edges[edge + 1] = this.#entryStart(entry) - start;
      this.#edges[edge + 2] = this.#entryTokenStart(entry) - tokenBase;
    }
    this.#lengths[id] = end - start;
    this.#blockNodes[id] = block;
    this.#rules[id] = rule;
    this.#buildStarts[id] = start;
    this.#buildEnds[id] = end;
    this.#buildTokenStarts[id] = tokenBase;
    this.#buildTokenEnds[id] = tokenLimit;
    return id;
  }

  #allocateEdges(count: number): number {
    if (count === 0) {
      return 0;
    }
    let selected = -1;
    for (let index = 0; index < this.#freeEdges.length; index++) {
      const candidate = this.#freeEdges[index];
      if (candidate.count >= count && (selected < 0 || candidate.count < this.#freeEdges[selected].count)) {
        selected = index;
      }
    }
    if (selected < 0) {
      const start = this.#edgeLength;
      this.#edgeLength += count;
      return start;
    }
    const range = this.#freeEdges[selected];
    const start = range.start;
    if (range.count === count) {
      this.#freeEdges.splice(selected, 1);
    }
    else {
      range.start += count;
      range.count -= count;
    }
    return start;
  }

  #buildRange(start: number, end: number): BlockRecord[] {
    const document: Frame = {
      block: false,
      close: "",
      rule: this.#schema.entryRule,
      children: [],
    };
    const stack = [document];

    for (let index = start; index < end; index++) {
      const token = this.#tokens[index];
      const current = stack.at(-1)!;
      const spec = this.#schema.frameByOpen[token.type];
      if (spec !== void 0) {
        stack.push({ ...spec, children: [leaf(index)] });
        continue;
      }

      const groupedRule = this.#schema.groupedRuleByToken[token.type];
      if (groupedRule !== void 0) {
        const children: number[] = [];
        do {
          children.push(leaf(index++));
        } while (
          index < end &&
          this.#schema.groupedRuleByToken[this.#tokens[index].type] === groupedRule
        );
        index--;
        current.children.push(this.#allocate(groupedRule, children));
        continue;
      }

      if (current.close === token.type) {
        current.children.push(leaf(index));
        stack.pop();
        const id = this.#allocate(current.rule, current.children, current.block);
        stack.at(-1)!.children.push(id);
        continue;
      }

      const leafRule = this.#schema.ruleByLeaf[token.type];
      if (leafRule !== void 0) {
        current.children.push(this.#allocate(leafRule, [leaf(index)], true));
        continue;
      }

      current.children.push(leaf(index));
    }

    if (stack.length !== 1) {
      throw new Error(`Block token stream did not close ${stack.at(-1)!.rule}`);
    }
    return document.children.map((id) => ({
      id,
      tokenStart: this.#buildTokenStarts[id],
      tokenEnd: this.#buildTokenEnds[id],
    }));
  }

  #entryEnd(entry: number): number {
    return entry < 0 ? tokenEnd(this.#tokens[~entry]) : this.#buildEnds[entry];
  }

  #entryStart(entry: number): number {
    return entry < 0 ? tokenStart(this.#tokens[~entry]) : this.#buildStarts[entry];
  }

  #entryTokenEnd(entry: number): number {
    return entry < 0 ? ~entry + 1 : this.#buildTokenEnds[entry];
  }

  #entryTokenStart(entry: number): number {
    return entry < 0 ? ~entry : this.#buildTokenStarts[entry];
  }

  #rebuildRoot(): void {
    const blocks = this.#blockRecords;
    const rootOffset = blocks.length === 0 ? 0 : tokenStart(this.#tokens[blocks[0].tokenStart]);
    const edgeStart = this.#allocateEdges(blocks.length);
    this.#edgeStarts[this.root] = edgeStart;
    this.#edgeCounts[this.root] = blocks.length;
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      const edge = (edgeStart + index) * 3;
      this.#edges[edge] = block.id;
      this.#edges[edge + 1] = tokenStart(this.#tokens[block.tokenStart]) - rootOffset;
      this.#edges[edge + 2] = block.tokenStart;
    }
    this.#lengths[this.root] = blocks.length === 0
      ? 0
      : tokenEnd(this.#tokens[blocks.at(-1)!.tokenEnd - 1]) - rootOffset;
  }

  #release(id: number): void {
    const stack = this.#releaseStack;
    stack.length = 1;
    stack[0] = id;
    while (stack.length > 0) {
      const released = stack.pop()!;
      const edgeStart = this.#edgeStarts[released];
      const edgeCount = this.#edgeCounts[released];
      for (let index = 0; index < edgeCount; index++) {
        const child = this.#edges[(edgeStart + index) * 3];
        if (child >= 0) {
          stack.push(child);
        }
      }
      this.#releaseEdges(released);
      this.#freeIds.push(released);
    }
  }

  #releaseEdges(id: number): void {
    const count = this.#edgeCounts[id];
    if (count > 0) {
      this.#freeEdges.push({ start: this.#edgeStarts[id], count });
      this.#edgeCounts[id] = 0;
    }
  }

  #coalesceFreeEdges(): void {
    const ranges = this.#freeEdges;
    if (ranges.length < 2) {
      return;
    }
    ranges.sort((left, right) => left.start - right.start);
    let write = 0;
    for (let read = 1; read < ranges.length; read++) {
      const current = ranges[write];
      const next = ranges[read];
      if (current.start + current.count === next.start) {
        current.count += next.count;
      }
      else {
        ranges[++write] = next;
      }
    }
    ranges.length = write + 1;
  }

  childAt(id: number, index: number): number {
    return this.#edges[(this.#edgeStarts[id] + index) * 3];
  }

  childCount(id: number): number {
    return this.#edgeCounts[id];
  }

  childRelAt(id: number, index: number): number {
    return this.#edges[(this.#edgeStarts[id] + index) * 3 + 1];
  }

  childTokRelAt(id: number, index: number): number {
    return this.#edges[(this.#edgeStarts[id] + index) * 3 + 2];
  }

  leafToken(entry: number, tokenBase: number): number {
    return tokenBase + ~entry;
  }

  leafTokenType(entry: number, tokenBase: number): string {
    return this.#tokens[this.leafToken(entry, tokenBase)].type;
  }

  lenOf(id: number): number {
    return this.#lengths[id];
  }

  isBlock(id: number): boolean {
    return this.#blockNodes[id];
  }

  ruleNameOf(id: number): string {
    return this.#rules[id];
  }
}
