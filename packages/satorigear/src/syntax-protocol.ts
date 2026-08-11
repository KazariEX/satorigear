export interface SyntaxArena {
  childAt: (id: number, index: number) => number;
  childCount: (id: number) => number;
  childRelAt: (id: number, index: number) => number;
  childTokRelAt: (id: number, index: number) => number;
  leafToken: (entry: number, tokenBase: number) => number;
  leafTokenType: (entry: number, tokenBase: number) => string;
  lenOf: (id: number) => number;
  ruleNameOf: (id: number) => string;
}
