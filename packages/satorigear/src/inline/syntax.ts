import { inlineKind } from "./kinds.ts";

export type InlineStructureRegistration =
  | {
    kind: "container";
    close: string;
    contentOpen: string;
    linkRule?: string;
    rule: string;
    token: string;
  }
  | {
    kind: "fallback";
    rule: string;
    tokens: readonly string[];
  }
  | {
    kind: "pair";
    close: string;
    entersLink?: true;
    linkRule?: string;
    open: string;
    rule: string;
  };

interface InlinePair {
  closeKind: number;
  entersLink: boolean;
  linkRuleId: number;
  ruleId: number;
}
interface InlineContainer {
  closeKind: number;
  contentOpenKind: number;
  linkRuleId: number;
  ruleId: number;
}

export interface InlineSyntaxSchema {
  containerByKind: readonly (InlineContainer | undefined)[];
  fallbackRuleByKind: readonly (number | undefined)[];
  inlineLinesRuleId: number;
  pairByOpenKind: readonly (InlinePair | undefined)[];
  ruleNames: readonly string[];
  tokenNames: readonly (string | undefined)[];
}

export function compileInlineSyntax(
  registrations: readonly InlineStructureRegistration[],
  tokenNames: readonly (string | undefined)[],
): InlineSyntaxSchema {
  const compiledTokenNames = [...tokenNames];
  const ruleNames: string[] = [];
  const ruleIds = new Map<string, number>();
  const ruleId = (name: string): number => {
    let id = ruleIds.get(name);
    if (id === void 0) {
      id = ruleNames.length;
      ruleIds.set(name, id);
      ruleNames.push(name);
    }
    return id;
  };
  const containerByKind: (InlineContainer | undefined)[] = [];
  const fallbackRuleByKind: (number | undefined)[] = [];
  const pairByOpenKind: (InlinePair | undefined)[] = [];

  for (const registration of registrations) {
    const registrationRuleId = ruleId(registration.rule);
    if (registration.kind === "fallback") {
      for (const token of registration.tokens) {
        fallbackRuleByKind[inlineKind(token)] = registrationRuleId;
      }
      continue;
    }

    const linkRuleId = registration.linkRule === void 0
      ? registrationRuleId
      : ruleId(registration.linkRule);
    if (registration.kind === "container") {
      containerByKind[inlineKind(registration.token)] = {
        closeKind: inlineKind(registration.close),
        contentOpenKind: inlineKind(registration.contentOpen),
        linkRuleId,
        ruleId: registrationRuleId,
      };
      continue;
    }

    pairByOpenKind[inlineKind(registration.open)] = {
      closeKind: inlineKind(registration.close),
      entersLink: registration.entersLink === true,
      linkRuleId,
      ruleId: registrationRuleId,
    };
  }

  const newlineKind = inlineKind("Newline");
  compiledTokenNames[newlineKind] = "Newline";
  return {
    containerByKind,
    fallbackRuleByKind,
    inlineLinesRuleId: ruleId("InlineLines"),
    pairByOpenKind,
    ruleNames,
    tokenNames: compiledTokenNames,
  };
}
