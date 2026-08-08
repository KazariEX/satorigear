import type { Token } from "monogram/gen-lexer.ts";
import {
  createEmittedParser,
  type EmittedArena,
  type EmittedParserDocument,
  type SyntaxArenaView,
} from "./emitted-parser.ts";
import * as generatedBlocks from "./generated/blocks.ts";
import * as generatedInline from "./generated/inline.ts";
import { InlineTokenState } from "./inline-tokenizer.ts";
import { normalizeMarkdownReferenceLabel } from "./inline-utils.ts";
import { createSourceView, projectSourceEdits, type SourceSpan, type SourceView } from "./source-view.ts";
import type { TextEdit } from "./text-edit.ts";

export interface MarkdownInlineSyntax {
  arena: EmittedArena;
  rootId: number;
  rootOffset: number;
  rootTokenBase: number;
  tokens: readonly Token[];
  view: SourceView;
}

export interface MarkdownSyntax {
  blockView: () => SyntaxArenaView;
  inlineForBlock: (nodeId: number) => MarkdownInlineSyntax | undefined;
}

export const blockSyntaxParser = createEmittedParser(
  generatedBlocks.tree,
  generatedBlocks.createParser,
  generatedBlocks.parseTokens,
);
const inlineSyntaxParser = createEmittedParser(
  generatedInline.tree,
  generatedInline.createParser,
  generatedInline.parseTokens,
);

function referenceLabelText(text: string): string | null {
  const open = text.indexOf("[");
  if (open < 0) {
    return null;
  }
  for (let offset = open + 1; offset < text.length; offset++) {
    if (text[offset] === "\\") {
      offset++;
    }
    else if (text[offset] === "]") {
      return normalizeMarkdownReferenceLabel(text.slice(open + 1, offset));
    }
  }
  return null;
}

interface InlineRegionDescriptor {
  id: number;
  rule: string;
  span: { end: number; start: number };
  view: SourceView;
}

class InlineRegion extends InlineTokenState {
  document?: EmittedParserDocument;
  id: number;
  revision = 0;
  rule: string;
  span: { end: number; start: number };
  view: SourceView;

  constructor(descriptor: InlineRegionDescriptor, labels: ReadonlySet<string>) {
    super();
    this.id = descriptor.id;
    this.rule = descriptor.rule;
    this.span = descriptor.span;
    this.view = descriptor.view;
    this.updateTokens(descriptor.view.text, labels);
  }

  #rebind(descriptor: InlineRegionDescriptor): void {
    this.id = descriptor.id;
    this.rule = descriptor.rule;
    this.span = descriptor.span;
    this.view = descriptor.view;
  }

  update(
    descriptor: InlineRegionDescriptor,
    labels: ReadonlySet<string>,
    edits: readonly TextEdit[] | null,
  ): this {
    const document = this.document;
    const sourceEdits = edits && this.view.text !== descriptor.view.text
      ? projectSourceEdits(this.view, descriptor.view, edits)
      : null;
    const changed = this.updateTokens(descriptor.view.text, labels, document?.edit, sourceEdits);
    this.#rebind(descriptor);
    if (!changed) {
      return this;
    }
    if (!document) {
      this.document = inlineSyntaxParser.createDocument(descriptor.view.text, this.tokens, "InlineLines");
    }
    this.revision++;
    return this;
  }
}

interface SyntaxBlock {
  id: number;
  offset: number;
  regionIds: readonly number[];
  regionRevisions: readonly number[];
  source: string;
  syntax: MarkdownSyntax;
  tokenBase: number;
  version: number;
}

function appendTokenSpans(spans: SourceSpan[], token: Token): void {
  if (token.ranges?.length) {
    for (const range of token.ranges) {
      spans.push({ start: range.offset, end: range.end });
    }
  }
  else {
    spans.push({ start: token.offset, end: token.offset + token.text.length });
  }
}

function inlineSpansOf(
  view: SyntaxArenaView,
  arena: EmittedArena,
  nodeId: number,
  tokenBase: number,
): SourceSpan[] {
  const spans: SourceSpan[] = [];
  const childCount = arena.childCount(nodeId);
  for (let index = 0; index < childCount; index++) {
    const entry = arena.childAt(nodeId, index);
    if (entry < 0) {
      const token = view.tokenAt(arena.leafToken(entry, tokenBase));
      if (token.type === "InlineChunk") {
        appendTokenSpans(spans, token);
      }
    }
  }
  return spans;
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

class MarkdownSyntaxImpl implements MarkdownSyntax {
  #blocks: readonly SyntaxBlock[] = [];
  #regions = new Map<number, InlineRegion>();
  #view: SyntaxArenaView;

  constructor(view: SyntaxArenaView, source: string) {
    this.#view = view;
    this.update(view, source);
  }

  blocks(): readonly SyntaxBlock[] {
    return this.#blocks;
  }

  update(view: SyntaxArenaView, source: string, edits: readonly TextEdit[] = []): void {
    const arena = view.arena;
    const labels = new Set<string>();
    const descriptors: InlineRegionDescriptor[] = [];
    const stableRegionIds = new Set<number>();
    const blocks: SyntaxBlock[] = [];
    const collect = (
      nodeId: number,
      offset: number,
      tokenBase: number,
      regionIds: number[],
    ): void => {
      const rule = arena.ruleNameOf(nodeId);
      if (rule === "LinkDefinition") {
        const label = referenceLabelText(source.slice(offset, offset + arena.lenOf(nodeId)));
        if (label) {
          labels.add(label);
        }
        return;
      }
      if (rule === "Paragraph" || rule === "AtxHeading" || rule === "SetextHeading") {
        const spans = inlineSpansOf(view, arena, nodeId, tokenBase);
        if (spans.length > 0) {
          descriptors.push({
            id: nodeId,
            rule,
            span: { start: offset, end: offset + arena.lenOf(nodeId) },
            view: createSourceView(source, spans),
          });
          stableRegionIds.add(nodeId);
          regionIds.push(nodeId);
        }
        return;
      }
      const childCount = arena.childCount(nodeId);
      for (let index = 0; index < childCount; index++) {
        const child = arena.childAt(nodeId, index);
        if (child >= 0) {
          collect(
            child,
            offset + arena.childRelAt(nodeId, index),
            tokenBase + arena.childTokRelAt(nodeId, index),
            regionIds,
          );
        }
      }
    };
    const root = view.root;
    const rootChildCount = arena.childCount(root.id);
    for (let index = 0; index < rootChildCount; index++) {
      const childId = arena.childAt(root.id, index);
      if (childId < 0 || arena.ruleNameOf(childId) !== "Block") {
        continue;
      }
      const offset = root.offset + arena.childRelAt(root.id, index);
      const tokenBase = root.tokenBase + arena.childTokRelAt(root.id, index);
      const regionIds: number[] = [];
      collect(childId, offset, tokenBase, regionIds);
      // Allocate each block record once; region revisions are filled after all regions resolve.
      blocks.push({
        id: childId,
        offset,
        regionIds,
        regionRevisions: [],
        source: source.slice(offset, offset + arena.lenOf(childId)),
        syntax: this,
        tokenBase,
        version: 0,
      });
    }

    // Inline resolution starts after the full reference map is known; later definitions affect earlier uses.
    const regions = new Map<number, InlineRegion>();
    const available: InlineRegion[] = [];
    for (const region of this.#regions.values()) {
      if (!stableRegionIds.has(region.id)) {
        available.push(region);
      }
    }
    for (const descriptor of descriptors) {
      let previous = this.#regions.get(descriptor.id);
      if (!previous) {
        // Rebind displaced state by rule and proximity when arena surgery changes node identities.
        let nearest = -1;
        let distance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < available.length; index++) {
          const candidate = available[index];
          const candidateDistance = candidate.rule === descriptor.rule
            ? Math.abs(candidate.span.start - descriptor.span.start)
            : Number.POSITIVE_INFINITY;
          if (candidateDistance < distance) {
            distance = candidateDistance;
            nearest = index;
          }
        }
        if (nearest >= 0) {
          previous = available.splice(nearest, 1)[0];
        }
      }
      const region = previous
        ? previous.update(descriptor, labels, edits)
        : new InlineRegion(descriptor, labels);
      regions.set(descriptor.id, region);
    }
    const previousBlocks = new Map(this.#blocks.map((block) => [block.id, block]));
    for (const block of blocks) {
      const previous = previousBlocks.get(block.id);
      const regionRevisions = block.regionIds.map((id) => {
        const region = regions.get(id);
        if (!region) {
          throw new Error(`Block references missing inline region ${id}`);
        }
        return region.revision;
      });
      const unchanged = previous?.source === block.source
        && sameNumbers(previous.regionIds, block.regionIds)
        && sameNumbers(previous.regionRevisions, regionRevisions);
      block.regionRevisions = regionRevisions;
      block.version = unchanged ? previous.version : (previous?.version ?? -1) + 1;
    }
    this.#view = view;
    this.#blocks = blocks;
    this.#regions = regions;
  }

  blockView(): SyntaxArenaView {
    return this.#view;
  }

  inlineForBlock(nodeId: number): MarkdownInlineSyntax | undefined {
    const region = this.#regions.get(nodeId);
    if (!region) {
      return;
    }
    // Edited regions own an arena; untouched regions use the shared stateless arena synchronously.
    const view = region.document?.view(region.tokens);
    const firstToken = region.tokens[0];
    return {
      arena: view?.arena ?? inlineSyntaxParser.arena,
      rootId: view?.root.id ?? inlineSyntaxParser.parseTokens(region.view.text, region.tokens, "InlineLines"),
      rootOffset: firstToken ? firstToken.ranges?.[0]?.offset ?? firstToken.offset : 0,
      rootTokenBase: 0,
      tokens: region.tokens,
      view: region.view,
    };
  }
}

export function createMarkdownSyntax(view: SyntaxArenaView, source: string): MarkdownSyntaxImpl {
  return new MarkdownSyntaxImpl(view, source);
}
