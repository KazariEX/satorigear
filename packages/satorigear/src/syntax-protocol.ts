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

export interface SyntaxArenaRoot {
  id: number;
  offset: number;
  tokenBase: number;
}

export interface SyntaxArenaView<Token> {
  readonly arena: SyntaxArena;
  readonly root: SyntaxArenaRoot;

  tokenAt: (index: number) => Token;
}

export interface TokenChange<Tokens> {
  oldEnd: number;
  oldStart: number;
  tokens: Tokens;
}
