import type { BlockToken } from "../block/tokens.ts";

export interface BlockLine {
  end: number;
  lazy?: boolean;
  next: number;
  prefixColumns?: number;
  start: number;
}

export type BlockStart = (
  source: string,
  lines: readonly BlockLine[],
  start: number,
  tokens: BlockToken[],
  contentOffset: number,
) => number | undefined;

export type BlockInterrupt = (
  source: string,
  line: BlockLine,
  contentOffset: number,
) => boolean;

export type BlockInterruptDispatch = BlockInterrupt | readonly BlockInterrupt[];
export type BlockStartDispatch = BlockStart | readonly BlockStart[];

export interface BlockStartRegistration {
  codes: readonly number[];
  interrupt?: BlockInterrupt;
  start: BlockStart;
}

export const projectBlockQuote = 1;
export const projectUnorderedList = 2;
export const projectOrderedList = 3;
export const projectAtxHeading = 4;
export const projectSetextHeading = 5;
export const projectParagraph = 6;
export const projectThematicBreak = 7;
export const projectFencedCode = 8;
export const projectIndentedCode = 9;
export const projectHtmlBlock = 10;
export const projectLinkDefinition = 11;
export type BlockProjectionOpcode =
  | typeof projectAtxHeading
  | typeof projectBlockQuote
  | typeof projectFencedCode
  | typeof projectHtmlBlock
  | typeof projectIndentedCode
  | typeof projectLinkDefinition
  | typeof projectOrderedList
  | typeof projectParagraph
  | typeof projectSetextHeading
  | typeof projectThematicBreak
  | typeof projectUnorderedList;

export interface BlockRuleRegistration {
  project: BlockProjectionOpcode;
  rule: string;
}

export interface InternalSyntaxPlugin {
  blockRules?: readonly BlockRuleRegistration[];
  blockStarts?: readonly BlockStartRegistration[];
}

export interface SyntaxProfile {
  blockInterrupts: readonly (BlockInterruptDispatch | undefined)[];
  blockProjects: Readonly<Record<string, BlockProjectionOpcode>>;
  blockStarts: readonly (BlockStartDispatch | undefined)[];
}

// Profiles bind runtime semantics to the static generated grammar without owning document state.
export function defineSyntaxProfile(plugins: readonly InternalSyntaxPlugin[]): SyntaxProfile {
  const blockInterrupts: (BlockInterruptDispatch | undefined)[] = [];
  const blockProjects: Record<string, BlockProjectionOpcode> = Object.create(null);
  const blockStarts: (BlockStartDispatch | undefined)[] = [];
  for (const plugin of plugins) {
    for (const registration of plugin.blockStarts ?? []) {
      for (const code of registration.codes) {
        const starts = blockStarts[code];
        blockStarts[code] = !starts
          ? registration.start
          : typeof starts === "function"
            ? [starts, registration.start]
            : [...starts, registration.start];
        if (registration.interrupt) {
          const interrupts = blockInterrupts[code];
          blockInterrupts[code] = !interrupts
            ? registration.interrupt
            : typeof interrupts === "function"
              ? [interrupts, registration.interrupt]
              : [...interrupts, registration.interrupt];
        }
      }
    }
    for (const registration of plugin.blockRules ?? []) {
      blockProjects[registration.rule] = registration.project;
    }
  }
  return { blockInterrupts, blockProjects, blockStarts };
}
