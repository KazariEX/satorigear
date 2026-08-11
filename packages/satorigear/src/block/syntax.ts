export interface BlockSyntaxFrame {
  close: string;
  rule: string;
  wrapsBlock: boolean;
}

export interface BlockSyntaxSchema {
  entryRule: string;
  frameByOpen: Readonly<Record<string, BlockSyntaxFrame | undefined>>;
  groupedRuleByToken: Readonly<Record<string, string | undefined>>;
  ruleByLeaf: Readonly<Record<string, string | undefined>>;
  wrapperRule: string;
}
