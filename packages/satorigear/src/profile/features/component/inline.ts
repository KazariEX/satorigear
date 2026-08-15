import { Character } from "../../../constants/character.ts";
import { InlineKind } from "../../../inline/kinds.ts";
import {
  appendInlineToken,
  firstInlineTokenEndingAfter,
  inlineTokenCount,
  inlineTokenEnd,
  inlineTokenFlags,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
} from "../../../inline/tokens.ts";
import {
  attributesEnd,
  componentNameEnd,
  normalizeComponentName,
} from "../attributes/syntax.ts";
import type { InlineLexicalRule } from "../../../inline/lexer.ts";
import type { InlineSyntaxDefinition } from "../../../inline/profile.ts";
import type { SourceSpan } from "../../../source-view.ts";

interface Candidate extends SourceSpan {
  children: Candidate[];
  close: number;
  contentEnd: number;
  contentStart: number;
  flags: number;
  inLinkLabel: boolean;
  kind: "component" | "span";
  literalInLink: boolean;
  nameEnd: number;
}

interface CandidateSet {
  normalClosers: ReadonlySet<number>;
  roots: Candidate[];
}

interface BracketOpening {
  children: Candidate[];
  componentIndex: number;
  image: boolean;
  start: number;
  tokenIndex: number;
}

function inlineComponentEnd(source: string, start: number): number | undefined {
  const previous = source[start - 1];
  if (
    start > 0 && previous !== " " && previous !== "\t" && previous !== "\n" &&
    previous !== "\r" && previous !== "*" && previous !== "_" && previous !== "["
  ) {
    return;
  }
  return componentNameEnd(source, start + 1, false);
}

export const inlineLexical: readonly InlineLexicalRule[] = [
  {
    marker: Character.Colon,
    scan(source, start, tokens) {
      const end = inlineComponentEnd(source, start);
      if (end === void 0) {
        return -1;
      }
      appendInlineToken(tokens, InlineKind.InlineComponentOpen, start, end);
      return end;
    },
  },
];

function appendLinkCandidates(target: Candidate[], candidates: readonly Candidate[]): void {
  for (const candidate of candidates) {
    candidate.inLinkLabel = true;
    if (candidate.children.length > 0) {
      const children: Candidate[] = [];
      appendLinkCandidates(children, candidate.children);
      candidate.children = children;
    }
    if (candidate.literalInLink) {
      // Bare spans stay literal inside link labels, but explicit components nested in them do not.
      target.push(...candidate.children);
    }
    else {
      target.push(candidate);
    }
  }
}

function candidates(
  source: string,
  tokens: InlineTokenStream,
): CandidateSet {
  const bracketStack: BracketOpening[] = [];
  const normalClosers = new Set<number>();
  const roots: Candidate[] = [];
  for (let index = 0; index < inlineTokenCount(tokens); index++) {
    const kind = inlineTokenKind(tokens, index);
    if (kind === InlineKind.BracketOpen) {
      const start = inlineTokenStart(tokens, index);
      const componentIndex = index - 1;
      bracketStack.push({
        children: [],
        componentIndex: componentIndex >= 0 &&
          inlineTokenKind(tokens, componentIndex) === InlineKind.InlineComponentOpen &&
          inlineTokenEnd(tokens, componentIndex) === start
          ? componentIndex
          : -1,
        image: false,
        start,
        tokenIndex: index,
      });
      continue;
    }
    if (kind === InlineKind.ImageOpen) {
      bracketStack.push({
        children: [],
        componentIndex: -1,
        image: true,
        start: inlineTokenEnd(tokens, index) - 1,
        tokenIndex: index,
      });
      continue;
    }
    if (
      kind !== InlineKind.BracketClose &&
      kind !== InlineKind.LinkTail &&
      kind !== InlineKind.ReferenceTail
    ) {
      continue;
    }
    const open = bracketStack.pop();
    if (!open) {
      continue;
    }
    const parent = bracketStack.at(-1)?.children ?? roots;
    if (open.image) {
      parent.push(...open.children);
      continue;
    }
    const close = inlineTokenStart(tokens, index);
    normalClosers.add(close);
    let children = open.children;
    if (kind === InlineKind.LinkTail || kind === InlineKind.ReferenceTail) {
      children = [];
      appendLinkCandidates(children, open.children);
    }
    if (open.componentIndex >= 0) {
      const start = inlineTokenStart(tokens, open.componentIndex);
      const flags = inlineTokenFlags(tokens, open.componentIndex);
      parent.push({
        children,
        close,
        contentEnd: close,
        contentStart: open.start + 1,
        end: close + 1,
        flags,
        inLinkLabel: false,
        kind: "component",
        literalInLink: false,
        nameEnd: open.start,
        start,
      });
      if (kind === InlineKind.ReferenceTail) {
        const suffixStart = close + 1;
        const suffixEnd = inlineTokenEnd(tokens, index);
        const suffixClose = suffixEnd - 1;
        parent.push({
          children: [],
          close: suffixClose,
          contentEnd: suffixClose,
          contentStart: suffixStart + 1,
          end: suffixEnd,
          flags,
          inLinkLabel: false,
          kind: "span",
          literalInLink: false,
          nameEnd: suffixStart + 1,
          start: suffixStart,
        });
      }
      continue;
    }
    if (source[close + 1] === "(" || source[close + 1] === "[") {
      parent.push(...children);
      continue;
    }
    const attributesStart = close + 1;
    const attributed = source[attributesStart] === "{" && attributesEnd(source, attributesStart) !== void 0;
    parent.push({
      children,
      close,
      contentEnd: close,
      contentStart: open.start + 1,
      end: close + 1,
      flags: inlineTokenFlags(tokens, open.tokenIndex),
      inLinkLabel: false,
      kind: "span",
      literalInLink: !attributed,
      nameEnd: open.start + 1,
      start: open.start,
    });
  }
  while (bracketStack.length > 0) {
    const opening = bracketStack.pop()!;
    const parent = bracketStack.at(-1)?.children ?? roots;
    parent.push(...opening.children);
  }
  return { normalClosers, roots };
}

function copyRange(
  target: number[],
  tokens: InlineTokenStream,
  start: number,
  end: number,
  inLinkLabel: boolean,
  normalClosers: ReadonlySet<number>,
): void {
  for (let index = firstInlineTokenEndingAfter(tokens, start); index < inlineTokenCount(tokens); index++) {
    const tokenStart = inlineTokenStart(tokens, index);
    if (tokenStart >= end) {
      break;
    }
    const kind = inlineTokenKind(tokens, index);
    const tokenEnd = inlineTokenEnd(tokens, index);
    const fragmentStart = Math.max(start, tokenStart);
    const fragmentEnd = Math.min(end, tokenEnd);
    // A component inside a link may contain bracket text, but activating that text as a
    // nested link would deactivate the outer CommonMark link.
    const literalLink = inLinkLabel && (
      kind === InlineKind.BracketOpen ||
      normalClosers.has(tokenStart) && (
        kind === InlineKind.LinkTail ||
        kind === InlineKind.ReferenceTail ||
        kind === InlineKind.BracketClose
      )
    );
    appendInlineToken(
      target,
      literalLink || fragmentStart !== tokenStart || fragmentEnd !== tokenEnd ? InlineKind.Text : kind,
      fragmentStart,
      fragmentEnd,
      fragmentStart === tokenStart ? inlineTokenFlags(tokens, index) : 0,
    );
  }
}

function emitRange(
  target: number[],
  tokens: InlineTokenStream,
  start: number,
  end: number,
  nested: readonly Candidate[],
  inLinkLabel: boolean,
  normalClosers: ReadonlySet<number>,
): void {
  let cursor = start;
  for (const candidate of nested) {
    copyRange(target, tokens, cursor, candidate.start, inLinkLabel, normalClosers);
    if (candidate.kind === "component") {
      appendInlineToken(target, InlineKind.InlineComponentOpen, candidate.start, candidate.nameEnd, candidate.flags);
      if (candidate.contentStart < candidate.contentEnd) {
        appendInlineToken(target, InlineKind.InlineComponentLabelOpen, candidate.nameEnd, candidate.contentStart);
        emitRange(
          target,
          tokens,
          candidate.contentStart,
          candidate.contentEnd,
          candidate.children,
          candidate.inLinkLabel,
          normalClosers,
        );
        appendInlineToken(target, InlineKind.InlineComponentLabelClose, candidate.close, candidate.close + 1);
      }
    }
    else {
      appendInlineToken(target, InlineKind.InlineSpanOpen, candidate.start, candidate.contentStart, candidate.flags);
      emitRange(
        target,
        tokens,
        candidate.contentStart,
        candidate.contentEnd,
        candidate.children,
        candidate.inLinkLabel,
        normalClosers,
      );
      appendInlineToken(target, InlineKind.InlineSpanClose, candidate.close, candidate.close + 1);
    }
    cursor = candidate.end;
  }
  copyRange(target, tokens, cursor, end, inLinkLabel, normalClosers);
}

// Reclassify CommonMark bracket/text tokens as explicit semantic carriers.
export function rewriteComponentTokens(
  source: string,
  tokens: InlineTokenStream,
): InlineTokenStream {
  // Bare components are already final lexical tokens; only labels and spans need bracket structure.
  if (!source.includes("[")) {
    return tokens;
  }
  const syntax = candidates(source, tokens);
  if (syntax.roots.length === 0) {
    return tokens;
  }
  const result: number[] = [];
  emitRange(result, tokens, 0, source.length, syntax.roots, false, syntax.normalClosers);
  return result;
}

export const inlineSyntax: readonly InlineSyntaxDefinition[] = [
  {
    kind: "container",
    isolateDelimiters: true,
    token: InlineKind.InlineComponentOpen,
    contentOpen: InlineKind.InlineComponentLabelOpen,
    close: InlineKind.InlineComponentLabelClose,
    build(open, close, sourceSpan, children, context) {
      const text = context.view.text.slice(
        inlineTokenStart(context.tokens, open) + 1,
        inlineTokenEnd(context.tokens, open),
      );
      return {
        type: "inlineComponent",
        name: normalizeComponentName(text),
        attributes: {},
        children,
        position: sourceSpan,
      };
    },
  },
  {
    kind: "pair",
    isolateDelimiters: true,
    open: InlineKind.InlineSpanOpen,
    close: InlineKind.InlineSpanClose,
    build(open, close, sourceSpan, children) {
      return {
        type: "inlineComponent",
        name: "span",
        attributes: {},
        children,
        position: sourceSpan,
      };
    },
  },
];
