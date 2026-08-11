export interface BlockSyntaxFrame {
  block: boolean;
  close: string;
  rule: string;
}

export interface BlockSyntaxSchema {
  entryRule: string;
  frameByOpen: Readonly<Record<string, BlockSyntaxFrame | undefined>>;
  groupedRuleByToken: Readonly<Record<string, string | undefined>>;
  ruleByLeaf: Readonly<Record<string, string | undefined>>;
}
