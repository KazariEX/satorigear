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
  nameEnd: number;
}

interface BracketIndex {
  linkLabels: SourceSpan[];
  normalClosers: Set<number>;
  pairs: Map<number, number>;
  referenceSuffixes: Map<number, number>;
}

interface CandidateSet {
  normalClosers: ReadonlySet<number>;
  roots: Candidate[];
}

function bracketIndex(tokens: InlineTokenStream): BracketIndex {
  const stack: Array<{ image: boolean; start: number }> = [];
  const pairs = new Map<number, number>();
  const linkLabels: SourceSpan[] = [];
  const normalClosers = new Set<number>();
  const referenceSuffixes = new Map<number, number>();
  for (let index = 0; index < inlineTokenCount(tokens); index++) {
    const kind = inlineTokenKind(tokens, index);
    if (kind === InlineKind.BracketOpen) {
      stack.push({ image: false, start: inlineTokenStart(tokens, index) });
    }
    else if (kind === InlineKind.ImageOpen) {
      stack.push({ image: true, start: inlineTokenEnd(tokens, index) - 1 });
    }
    else if (
      kind === InlineKind.ShortcutReferenceTail ||
      kind === InlineKind.LinkTail ||
      kind === InlineKind.ReferenceTail
    ) {
      const open = stack.pop();
      if (open !== void 0) {
        const close = inlineTokenStart(tokens, index);
        if (!open.image) {
          pairs.set(open.start, close);
          normalClosers.add(close);
          if (kind === InlineKind.LinkTail || kind === InlineKind.ReferenceTail) {
            let nested = linkLabels.at(-1);
            while (nested && nested.start > open.start) {
              linkLabels.pop();
              nested = linkLabels.at(-1);
            }
            linkLabels.push({ start: open.start, end: close });
          }
          if (kind === InlineKind.ReferenceTail) {
            referenceSuffixes.set(close, inlineTokenEnd(tokens, index));
          }
        }
      }
    }
  }
  return { linkLabels, normalClosers, pairs, referenceSuffixes };
}

function componentCandidate(
  source: string,
  start: number,
  flags: number,
  pairs: ReadonlyMap<number, number>,
): Candidate | undefined {
  const previous = source[start - 1];
  if (
    start > 0 && previous !== " " && previous !== "\t" && previous !== "\n" &&
    previous !== "\r" && previous !== "*" && previous !== "_" && previous !== "["
  ) {
    return;
  }
  const nameEnd = componentNameEnd(source, start + 1, false);
  if (nameEnd === void 0) {
    return;
  }
  const close = source[nameEnd] === "[" ? pairs.get(nameEnd) : void 0;
  if (close === void 0) {
    return {
      children: [],
      close: nameEnd,
      contentEnd: nameEnd,
      contentStart: nameEnd,
      end: nameEnd,
      flags,
      inLinkLabel: false,
      kind: "component",
      nameEnd,
      start,
    };
  }
  return {
    children: [],
    close,
    contentEnd: close,
    contentStart: nameEnd + 1,
    end: close + 1,
    flags,
    inLinkLabel: false,
    kind: "component",
    nameEnd,
    start,
  };
}

function insideLinkLabel(
  offset: number,
  labels: readonly SourceSpan[],
): boolean {
  let start = 0;
  let end = labels.length;
  while (start < end) {
    const middle = (start + end) >>> 1;
    if (labels[middle].end <= offset) {
      start = middle + 1;
    }
    else {
      end = middle;
    }
  }
  const label = labels[start];
  return label !== void 0 && offset > label.start;
}

function candidates(
  source: string,
  tokens: InlineTokenStream,
): CandidateSet {
  const brackets = bracketIndex(tokens);
  const result: Candidate[] = [];
  const componentLabels = new Set<number>();
  for (let index = 0; index < inlineTokenCount(tokens); index++) {
    if (inlineTokenKind(tokens, index) !== InlineKind.Text) {
      continue;
    }
    const start = inlineTokenStart(tokens, index);
    const end = inlineTokenEnd(tokens, index);
    for (let offset = source.indexOf(":", start); offset >= start && offset < end; offset = source.indexOf(":", offset + 1)) {
      const candidate = componentCandidate(
        source,
        offset,
        inlineTokenFlags(tokens, index),
        brackets.pairs,
      );
      if (candidate) {
        candidate.inLinkLabel = insideLinkLabel(candidate.start, brackets.linkLabels);
        result.push(candidate);
        if (candidate.close > candidate.nameEnd) {
          componentLabels.add(candidate.nameEnd);
          const suffixEnd = brackets.referenceSuffixes.get(candidate.close);
          if (suffixEnd !== void 0) {
            const suffixStart = candidate.close + 1;
            const suffixClose = suffixEnd - 1;
            result.push({
              children: [],
              close: suffixClose,
              contentEnd: suffixClose,
              contentStart: suffixStart + 1,
              end: suffixEnd,
              flags: candidate.flags,
              inLinkLabel: insideLinkLabel(suffixStart, brackets.linkLabels),
              kind: "span",
              nameEnd: suffixStart + 1,
              start: suffixStart,
            });
          }
        }
        offset = candidate.nameEnd - 1;
      }
    }
  }
  for (let index = 0; index < inlineTokenCount(tokens); index++) {
    if (inlineTokenKind(tokens, index) !== InlineKind.BracketOpen) {
      continue;
    }
    const start = inlineTokenStart(tokens, index);
    if (componentLabels.has(start)) {
      continue;
    }
    const close = brackets.pairs.get(start);
    if (close === void 0 || source[close + 1] === "(" || source[close + 1] === "[") {
      continue;
    }
    const attributesStart = close + 1;
    const attributed = source[attributesStart] === "{" && attributesEnd(source, attributesStart) !== void 0;
    const inLinkLabel = insideLinkLabel(start, brackets.linkLabels);
    if (!attributed && inLinkLabel) {
      continue;
    }
    result.push({
      children: [],
      close,
      contentEnd: close,
      contentStart: start + 1,
      end: close + 1,
      flags: inlineTokenFlags(tokens, index),
      inLinkLabel,
      kind: "span",
      nameEnd: start + 1,
      start,
    });
  }
  result.sort((left, right) => left.start - right.start || right.end - left.end);
  const roots: Candidate[] = [];
  const stack: Candidate[] = [];
  for (const candidate of result) {
    while (stack.length > 0 && candidate.start >= stack.at(-1)!.end) {
      stack.pop();
    }
    const parent = stack.at(-1);
    if (parent && candidate.start >= parent.contentStart && candidate.end <= parent.contentEnd) {
      parent.children.push(candidate);
    }
    else if (!parent) {
      roots.push(candidate);
    }
    else {
      continue;
    }
    if (candidate.end > candidate.start) {
      stack.push(candidate);
    }
  }
  return { normalClosers: brackets.normalClosers, roots };
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
        kind === InlineKind.ShortcutReferenceTail
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
export function transformComponentTokens(
  source: string,
  tokens: InlineTokenStream,
): InlineTokenStream {
  // Avoid building the bracket index when no component or span can start.
  if (!source.includes(":") && !source.includes("[")) {
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
