import type { PhrasingContent } from "mdast";
import {
  appendInlineToken,
  inlineKind,
  inlineTokenCount,
  inlineTokenEnd,
  inlineTokenFlags,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
} from "../../../inline/runtime.ts";
import {
  appendInline,
  contentBounds,
  createInlineAccumulator,
  directLeaf,
  inlineSequence,
  lineEnd,
  projectInlineIgnore,
  withSpan,
} from "../../../mdast.ts";
import {
  attributesEnd,
  componentNameEnd,
  normalizeComponentName,
} from "../attributes/syntax.ts";
import type { InlineRuleProjector } from "../../../mdast.ts";
import type { SyntaxFeature } from "../../types.ts";
import type { InlineComponent } from "./types.ts";

interface Candidate {
  children: Candidate[];
  close: number;
  contentEnd: number;
  contentStart: number;
  end: number;
  flags: number;
  inLinkLabel: boolean;
  kind: "component" | "span";
  nameEnd: number;
  start: number;
}

interface BracketIndex {
  linkLabels: Array<{ end: number; start: number }>;
  normalClosers: Set<number>;
  pairs: Map<number, number>;
  referenceSuffixes: Map<number, number>;
}

interface CandidateSet {
  normalClosers: ReadonlySet<number>;
  roots: Candidate[];
}

const bracketOpenKind = inlineKind("BracketOpen");
const imageOpenKind = inlineKind("ImageOpen");
const linkTailKind = inlineKind("LinkTail");
const referenceTailKind = inlineKind("ReferenceTail");
const shortcutTailKind = inlineKind("ShortcutReferenceTail");
const textKind = inlineKind("Text");
const componentOpenKind = inlineKind("InlineComponentOpen");
const componentLabelOpenKind = inlineKind("InlineComponentLabelOpen");
const componentLabelCloseKind = inlineKind("InlineComponentLabelClose");
const spanOpenKind = inlineKind("InlineSpanOpen");
const spanCloseKind = inlineKind("InlineSpanClose");
const inlineBoundaryKind = inlineKind("InlineBoundary");

function bracketIndex(tokens: InlineTokenStream): BracketIndex {
  const stack: Array<{ image: boolean; start: number }> = [];
  const pairs = new Map<number, number>();
  const linkLabels: Array<{ end: number; start: number }> = [];
  const normalClosers = new Set<number>();
  const referenceSuffixes = new Map<number, number>();
  for (let index = 0; index < inlineTokenCount(tokens); index++) {
    const kind = inlineTokenKind(tokens, index);
    if (kind === inlineBoundaryKind) {
      stack.length = 0;
    }
    else if (kind === bracketOpenKind) {
      stack.push({ image: false, start: inlineTokenStart(tokens, index) });
    }
    else if (kind === imageOpenKind) {
      stack.push({ image: true, start: inlineTokenEnd(tokens, index) - 1 });
    }
    else if (kind === shortcutTailKind || kind === linkTailKind || kind === referenceTailKind) {
      const open = stack.pop();
      if (open !== void 0) {
        const close = inlineTokenStart(tokens, index);
        if (!open.image) {
          pairs.set(open.start, close);
          normalClosers.add(close);
          if (kind === linkTailKind || kind === referenceTailKind) {
            linkLabels.push({ start: open.start, end: close });
          }
          if (kind === referenceTailKind) {
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
  if (source[nameEnd] !== "[") {
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
  const close = pairs.get(nameEnd);
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

function insideLinkLabel(offset: number, labels: readonly { end: number; start: number }[]): boolean {
  return labels.some((label) => offset > label.start && offset < label.end);
}

function candidates(
  source: string,
  tokens: InlineTokenStream,
): CandidateSet {
  const brackets = bracketIndex(tokens);
  const result: Candidate[] = [];
  const componentLabels = new Set<number>();
  let attributeLineEnd = 0;
  for (let index = 0; index < inlineTokenCount(tokens); index++) {
    if (inlineTokenKind(tokens, index) !== textKind) {
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
    if (inlineTokenKind(tokens, index) !== bracketOpenKind) {
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
    let attributed = false;
    if (source[attributesStart] === "{") {
      if (attributesStart >= attributeLineEnd) {
        attributeLineEnd = lineEnd(source, attributesStart);
      }
      attributed = attributesEnd(source, attributesStart, attributeLineEnd) !== void 0;
    }
    if (!attributed && insideLinkLabel(start, brackets.linkLabels)) {
      continue;
    }
    result.push({
      children: [],
      close,
      contentEnd: close,
      contentStart: start + 1,
      end: close + 1,
      flags: inlineTokenFlags(tokens, index),
      inLinkLabel: insideLinkLabel(start, brackets.linkLabels),
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

function firstTokenEndingAfter(tokens: InlineTokenStream, offset: number): number {
  let low = 0;
  let high = inlineTokenCount(tokens);
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (inlineTokenEnd(tokens, middle) <= offset) {
      low = middle + 1;
    }
    else {
      high = middle;
    }
  }
  return low;
}

function copyRange(
  target: number[],
  tokens: InlineTokenStream,
  start: number,
  end: number,
  inLinkLabel: boolean,
  normalClosers: ReadonlySet<number>,
): void {
  for (let index = firstTokenEndingAfter(tokens, start); index < inlineTokenCount(tokens); index++) {
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
      kind === bracketOpenKind ||
      normalClosers.has(tokenStart) && (
        kind === linkTailKind || kind === referenceTailKind || kind === shortcutTailKind
      )
    );
    appendInlineToken(
      target,
      literalLink || fragmentStart !== tokenStart || fragmentEnd !== tokenEnd ? textKind : kind,
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
      appendInlineToken(target, componentOpenKind, candidate.start, candidate.nameEnd, candidate.flags);
      if (candidate.contentStart < candidate.contentEnd) {
        appendInlineToken(target, componentLabelOpenKind, candidate.nameEnd, candidate.contentStart);
        emitRange(
          target,
          tokens,
          candidate.contentStart,
          candidate.contentEnd,
          candidate.children,
          candidate.inLinkLabel,
          normalClosers,
        );
        appendInlineToken(target, componentLabelCloseKind, candidate.close, candidate.close + 1);
      }
    }
    else {
      appendInlineToken(target, spanOpenKind, candidate.start, candidate.contentStart, candidate.flags);
      emitRange(
        target,
        tokens,
        candidate.contentStart,
        candidate.contentEnd,
        candidate.children,
        candidate.inLinkLabel,
        normalClosers,
      );
      appendInlineToken(target, spanCloseKind, candidate.close, candidate.close + 1);
    }
    cursor = candidate.end;
  }
  copyRange(target, tokens, cursor, end, inLinkLabel, normalClosers);
}

// Reclassify CommonMark bracket/text tokens as the explicit carriers consumed by the shared grammar.
export function transformInlineCarrier(
  source: string,
  tokens: InlineTokenStream,
): InlineTokenStream {
  const syntax = candidates(source, tokens);
  if (syntax.roots.length === 0) {
    return tokens;
  }
  const result: number[] = [];
  emitRange(result, tokens, 0, source.length, syntax.roots, false, syntax.normalClosers);
  return result;
}

const projectInlineComponent: InlineRuleProjector = (
  nodeId,
  offset,
  tokenBase,
  endOffset,
  sourceSpan,
  accumulator,
) => {
  const { context } = accumulator;
  const open = directLeaf(nodeId, tokenBase, "InlineComponentOpen", context);
  if (open === void 0) {
    throw new Error("InlineComponent does not contain an opener");
  }
  const children: PhrasingContent[] = [];
  const labelOpen = directLeaf(nodeId, tokenBase, "InlineComponentLabelOpen", context);
  if (labelOpen !== void 0) {
    const [start, end] = contentBounds(
      nodeId,
      tokenBase,
      ["InlineComponentLabelOpen"],
      ["InlineComponentLabelClose"],
      context,
    );
    inlineSequence(nodeId, offset, tokenBase, createInlineAccumulator(context, children), start, end);
  }
  const text = context.view.text.slice(
    inlineTokenStart(context.tokens, open) + 1,
    inlineTokenEnd(context.tokens, open),
  );
  const value: InlineComponent = {
    type: "inlineComponent",
    name: normalizeComponentName(text),
    attributes: {},
    children,
  };
  appendInline(
    accumulator,
    withSpan(value, sourceSpan.start, sourceSpan.end),
    sourceSpan.start,
  );
  return true;
};

const projectInlineSpan: InlineRuleProjector = (
  nodeId,
  offset,
  tokenBase,
  endOffset,
  sourceSpan,
  accumulator,
) => {
  const { context } = accumulator;
  const [start, end] = contentBounds(
    nodeId,
    tokenBase,
    ["InlineSpanOpen"],
    ["InlineSpanClose"],
    context,
  );
  const children: PhrasingContent[] = [];
  inlineSequence(nodeId, offset, tokenBase, createInlineAccumulator(context, children), start, end);
  const value: InlineComponent = {
    type: "inlineComponent",
    name: "span",
    attributes: {},
    children,
  };
  appendInline(
    accumulator,
    withSpan(value, sourceSpan.start, sourceSpan.end),
    sourceSpan.start,
  );
  return true;
};

export const inlineRules: SyntaxFeature["inlineRules"] = [
  { rule: "InlineComponent", project: projectInlineComponent },
  { rule: "LinkComponent", project: projectInlineComponent },
  { rule: "InlineSpan", project: projectInlineSpan },
  { rule: "LinkSpan", project: projectInlineSpan },
];

export const inlineTokens: SyntaxFeature["inlineTokens"] = [
  { token: "InlineComponentOpen", project: projectInlineIgnore },
  { token: "InlineComponentLabelOpen", project: projectInlineIgnore },
  { token: "InlineComponentLabelClose", project: projectInlineIgnore },
  { token: "InlineSpanOpen", project: projectInlineIgnore },
  { token: "InlineSpanClose", project: projectInlineIgnore },
];
