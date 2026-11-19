import { Character } from "../constants/character.ts";
import { InlineKind, InlineRole } from "../constants/inline.ts";
import { compileDelimiterConfigs, type DelimiterConfig, DelimiterStack } from "../inline/delimiter.ts";
import {
  inlineTokenCount,
  inlineTokenEnd,
  InlineTokenField,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
} from "../inline/tokens.ts";
import { attributesEnd } from "./features/attributes/shared.ts";
import { footnoteLabelAt } from "./features/footnote/shared.ts";
import { isMarkdownWhitespace, normalizeIdentifier } from "./utils.ts";
import type { DefinitionLookup } from "../block/tokens.ts";

interface InlineResolverOptions {
  component: boolean;
  footnote: boolean;
}

export type InlineResolver = (
  source: string,
  tokens: InlineTokenStream,
  definitions: DefinitionLookup,
) => InlineTokenStream;

export type InlineResolverFactory = (delimiters: readonly DelimiterConfig[]) => InlineResolver;

function referenceLabelEnd(source: string, start: number): number {
  if (source.charCodeAt(start) !== Character.LeftSquareBracket) {
    return -1;
  }
  let offset = start + 1;
  if (source.charCodeAt(offset) === Character.RightSquareBracket) {
    return offset + 1;
  }
  let characters = 0;
  let hasContent = false;
  while (offset < source.length && characters < 999) {
    const code = source.charCodeAt(offset);
    if (code === Character.RightSquareBracket) {
      return hasContent ? offset + 1 : -1;
    }
    if (code === Character.LeftSquareBracket) {
      return -1;
    }
    if (code === Character.ReverseSolidus) {
      if (offset + 1 >= source.length) {
        return -1;
      }
      hasContent = true;
      offset += 2;
    }
    else {
      hasContent ||= !isMarkdownWhitespace(code);
      offset++;
    }
    characters++;
  }
  return -1;
}

// Unicode mode counts surrogate pairs once; dotAll includes line endings in the label.
const withinLabelLimit = /^.{1,999}$/su;
const acceptedLabel = /[^ \t\r\n]/;

function acceptsShortcutLabel(label: string): boolean {
  // Above 999 code units a valid label necessarily contains a nonblank surrogate pair.
  return label.length > 999
    ? label.length <= 2 * 999 && withinLabelLimit.test(label)
    : acceptedLabel.test(label);
}

function opensComponentLabel(tokens: InlineTokenStream, open: number): boolean {
  return open > 0 &&
    inlineTokenKind(tokens, open - 1) === InlineKind.InlineComponent &&
    inlineTokenEnd(tokens, open - 1) === inlineTokenStart(tokens, open);
}

// Physical mates remain stable when reference suffixes consume tokens or nested links become literal.
function pairBrackets(tokens: InlineTokenStream, start: number, end: number): number[] {
  const mates = new Array<number>(end);
  const openers: number[] = [];
  for (let index = start; index < end; index++) {
    const kind = inlineTokenKind(tokens, index);
    if (kind === InlineKind.BracketOpen || kind === InlineKind.ImageOpen) {
      openers.push(index);
    }
    else if (kind === InlineKind.BracketClose || kind === InlineKind.LinkTail) {
      const open = openers.pop();
      if (open !== void 0) {
        mates[open] = index;
        mates[index] = open;
      }
    }
  }
  return mates;
}

function componentOpening(
  source: string,
  tokens: InlineTokenStream,
  open: number,
  close: number,
  insideLink: boolean,
): InlineKind {
  if (opensComponentLabel(tokens, open)) {
    return InlineKind.InlineComponentOpen;
  }
  const suffix = inlineTokenStart(tokens, close) + 1;
  const trailing = source.charCodeAt(suffix);
  if (trailing === Character.LeftParenthesis || trailing === Character.LeftSquareBracket) {
    return InlineKind.None;
  }
  // A link label keeps attributed spans. Bare brackets follow ordinary link resolution.
  if (insideLink && (trailing !== Character.LeftCurlyBracket || attributesEnd(source, suffix) === void 0)) {
    return InlineKind.None;
  }
  return InlineKind.InlineSpanOpen;
}

function matchedLinkEnd(
  source: string,
  tokens: InlineTokenStream,
  definitions: DefinitionLookup,
  open: number,
  close: number,
  lastVisibleOpener: number,
): number {
  const end = inlineTokenEnd(tokens, close);
  if (inlineTokenKind(tokens, close) === InlineKind.LinkTail) {
    return end;
  }
  if (!definitions.hasDefinitions()) {
    return -1;
  }
  const contentStart = inlineTokenEnd(tokens, open);
  const contentEnd = inlineTokenStart(tokens, close);
  const labelEnd = referenceLabelEnd(source, end);
  if (labelEnd > 0) {
    const label = labelEnd === end + 2
      ? source.slice(contentStart, contentEnd)
      : source.slice(end + 1, labelEnd - 1);
    return definitions.hasDefinition(normalizeIdentifier(label)) ? labelEnd : -1;
  }
  if (lastVisibleOpener > open) {
    return -1;
  }
  const label = source.slice(contentStart, contentEnd);
  return acceptsShortcutLabel(label) && definitions.hasDefinition(normalizeIdentifier(label)) ? end : -1;
}

function setBoundary(tokens: number[], index: number, kind: InlineKind, end: number): void {
  const field = index * InlineTokenField.Stride;
  tokens[field | InlineTokenField.Kind] = kind;
  tokens[field | InlineTokenField.End] = end;
}

function resolvePairs(
  source: string,
  tokens: number[],
  definitions: DefinitionLookup,
  options: InlineResolverOptions,
  delimiters: ReturnType<typeof compileDelimiterConfigs>,
  start: number,
): InlineTokenStream {
  // This suffix is owned by resolution. The lexer stream retained for edits stays reusable.
  const end = inlineTokenCount(tokens);
  const openers: number[] = [];
  const scopes = new DelimiterStack();
  let mates: number[] | undefined;
  let lastVisibleOpener = -1;
  let lastLinkOpener = -1;
  let literalLabelEnd = -1;
  let resourceLabelEnd = -1;
  let consumedEnd = -1;

  for (let index = start; index < end; index++) {
    const kind = inlineTokenKind(tokens, index);
    const opener = kind === InlineKind.BracketOpen || kind === InlineKind.ImageOpen;
    if (
      opener && (
        options.component ||
        options.footnote && source.charCodeAt(inlineTokenEnd(tokens, index)) === Character.CircumflexAccent
      )
    ) {
      mates ??= pairBrackets(tokens, index, end);
    }
    const close = opener ? mates?.[index] : void 0;
    const component = options.component && kind === InlineKind.BracketOpen && close !== void 0;
    // Physical link labels nest. Remember the furthest closer, including when a
    // reference suffix consumes an opener before its physical closer is reached.
    const insideLink = index < resourceLabelEnd;
    if (component && inlineTokenKind(tokens, close) === InlineKind.LinkTail) {
      resourceLabelEnd = Math.max(resourceLabelEnd, close);
    }
    if (consumedEnd >= 0 && inlineTokenStart(tokens, index) < consumedEnd) {
      tokens[index * InlineTokenField.Stride | InlineTokenField.Kind] = InlineKind.None;
      continue;
    }
    const delimiter = delimiters[kind];
    if (delimiter) {
      scopes.add(source, tokens, index, delimiter);
      continue;
    }
    if (opener) {
      if (options.footnote && close !== void 0 && inlineTokenKind(tokens, close) === InlineKind.BracketClose) {
        const label = footnoteLabelAt(source, inlineTokenEnd(tokens, index) - 1, source.length);
        if (label && label.end === inlineTokenEnd(tokens, close) && definitions.hasDefinition(label.definitionKey)) {
          consumedEnd = label.end;
          setBoundary(tokens, index, InlineKind.FootnoteReference, consumedEnd);
          if (kind === InlineKind.ImageOpen) {
            tokens[index * InlineTokenField.Stride | InlineTokenField.Start]++;
          }
          continue;
        }
      }
      if (component) {
        const opening = componentOpening(source, tokens, index, close, insideLink);
        if (opening !== InlineKind.None) {
          tokens[index * InlineTokenField.Stride | InlineTokenField.Kind] = opening;
          if (insideLink) {
            literalLabelEnd = Math.max(literalLabelEnd, close);
          }
          continue;
        }
      }
      if (index < literalLabelEnd && kind !== InlineKind.ImageOpen) {
        tokens[index * InlineTokenField.Stride | InlineTokenField.Kind] = InlineKind.None;
        if (close !== void 0) {
          tokens[close * InlineTokenField.Stride | InlineTokenField.Kind] = InlineKind.None;
        }
        continue;
      }
      openers.push(index);
      lastVisibleOpener = index;
      continue;
    }
    if (kind !== InlineKind.BracketClose && kind !== InlineKind.LinkTail) {
      continue;
    }

    const mate = mates?.[index];
    const claim = mate === void 0 ? void 0 : inlineTokenKind(tokens, mate);
    let open: number;
    if (claim === InlineKind.InlineComponentOpen || claim === InlineKind.InlineSpanOpen) {
      open = mate!;
      const at = inlineTokenStart(tokens, index);
      const openingEnd = inlineTokenEnd(tokens, open);
      if (claim === InlineKind.InlineComponentOpen) {
        // Its name and label form one node. An empty label leaves the component a leaf.
        tokens[open * InlineTokenField.Stride | InlineTokenField.Kind] = InlineKind.None;
        if (openingEnd >= at) {
          tokens[index * InlineTokenField.Stride | InlineTokenField.Kind] = InlineKind.None;
        }
        else {
          setBoundary(tokens, open - 1, claim, openingEnd);
          setBoundary(tokens, index, claim + 1, at + 1);
        }
      }
      else {
        setBoundary(tokens, index, claim + 1, at + 1);
      }
    }
    else {
      if (index < literalLabelEnd && mate !== void 0 && inlineTokenKind(tokens, mate) !== InlineKind.ImageOpen) {
        continue;
      }
      const label = openers.pop();
      if (label === void 0) {
        continue;
      }
      const image = inlineTokenKind(tokens, label) === InlineKind.ImageOpen;
      if (!image && label < lastLinkOpener) {
        continue;
      }
      const closeEnd = matchedLinkEnd(source, tokens, definitions, label, index, lastVisibleOpener);
      if (closeEnd < 0) {
        continue;
      }
      open = label;
      const opening = (kind === InlineKind.LinkTail ? InlineKind.LinkOpen : InlineKind.ReferenceOpen) + (image ? 2 : 0);
      const tokenEnd = inlineTokenEnd(tokens, index);
      tokens[open * InlineTokenField.Stride | InlineTokenField.Kind] = opening;
      setBoundary(tokens, index, opening + 1, closeEnd);
      if (!image) {
        lastLinkOpener = open;
      }
      if (closeEnd > tokenEnd) {
        consumedEnd = closeEnd;
      }
    }
    scopes.close(tokens, open);
  }
  scopes.close(tokens);
  return scopes.emitResolvedTokens(tokens);
}

export function compileInlineResolver(options: InlineResolverOptions): InlineResolverFactory {
  return (delimiterConfigs) => {
    const delimiterByKind = compileDelimiterConfigs(delimiterConfigs);
    return (source, tokens, definitions) => {
      let start = 0;
      let resolved: number[] | undefined;
      let hasLiteralBrackets = false;
      const end = inlineTokenCount(tokens);
      while (start < end) {
        const kind = inlineTokenKind(tokens, start);
        if (kind >= InlineRole.Text) {
          start++;
          continue;
        }
        if (kind !== InlineKind.BracketOpen && kind !== InlineKind.ImageOpen) {
          break;
        }
        if (kind === InlineKind.BracketOpen && options.component && opensComponentLabel(tokens, start)) {
          break;
        }
        let close = start + 1;
        while (close < end) {
          const inner = inlineTokenKind(tokens, close);
          if (inner < InlineRole.Text || inner === InlineKind.LinkTail) {
            break;
          }
          close++;
        }
        const closing = close === end ? InlineKind.None : inlineTokenKind(tokens, close);
        const resource = closing === InlineKind.LinkTail;
        if (
          closing !== InlineKind.None && !resource && (
            closing !== InlineKind.BracketClose ||
            options.component ||
            options.footnote && source.charCodeAt(inlineTokenEnd(tokens, start)) === Character.CircumflexAccent || definitions.hasDefinitions()
          )
        ) {
          break;
        }
        if (!resource) {
          hasLiteralBrackets = true;
          start = close < end ? close + 1 : end;
          continue;
        }
        // A flat resource changes only its two boundaries, preserving every token index.
        resolved ??= tokens.slice();
        const opening = kind === InlineKind.ImageOpen ? InlineKind.ImageLinkOpen : InlineKind.LinkOpen;
        resolved[start * InlineTokenField.Stride | InlineTokenField.Kind] = opening;
        resolved[close * InlineTokenField.Stride | InlineTokenField.Kind] = opening + 1;
        start = close + 1;
      }
      if (start === end) {
        const settled = resolved ?? tokens;
        return hasLiteralBrackets ? new DelimiterStack().emitResolvedTokens(settled) : settled;
      }
      return resolvePairs(source, resolved ?? tokens.slice(), definitions, options, delimiterByKind, start);
    };
  };
}
