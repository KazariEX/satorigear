import { describe, expect, it } from "vitest";
import { BlockTokenStream } from "../packages/satorigear/src/block/tokens.ts";
import { BlockKind } from "../packages/satorigear/src/constants/block.ts";

function pushToken(
  tokens: BlockTokenStream,
  start: number,
  end: number,
  definitionKey?: string,
): void {
  tokens.push(
    BlockKind.InlineChunk,
    start,
    end,
    definitionKey === void 0 ? void 0 : { definitionKey },
  );
}

describe("block token definitions", () => {
  it("reports only document-wide definition membership changes", () => {
    const tokens = new BlockTokenStream(4);
    pushToken(tokens, 0, 1, "a");
    pushToken(tokens, 1, 2);
    pushToken(tokens, 2, 3, "a");
    pushToken(tokens, 3, 4, "b");
    expect(tokens.hasDefinition("a")).toBe(true);
    expect(tokens.hasDefinition("b")).toBe(true);

    const shiftedReplacement = new BlockTokenStream(5);
    pushToken(shiftedReplacement, 1, 2);
    pushToken(shiftedReplacement, 2, 3, "a");
    pushToken(shiftedReplacement, 3, 4);
    expect(tokens.replace(1, 3, shiftedReplacement, 1, 3).definitionMembershipChanges).toEqual(new Set());

    const withoutFirstDuplicate = new BlockTokenStream(5);
    pushToken(withoutFirstDuplicate, 0, 1);
    expect(tokens.replace(0, 1, withoutFirstDuplicate, 0, 1).definitionMembershipChanges).toEqual(new Set());
    expect(tokens.hasDefinition("a")).toBe(true);

    const withoutLastDuplicate = new BlockTokenStream(5);
    pushToken(withoutLastDuplicate, 2, 3);
    expect(tokens.replace(2, 3, withoutLastDuplicate, 2, 3).definitionMembershipChanges).toEqual(new Set(["a"]));
    expect(tokens.hasDefinition("a")).toBe(false);
    expect(tokens.hasDefinition("b")).toBe(true);

    const renamedDefinition = new BlockTokenStream(5);
    pushToken(renamedDefinition, 3, 4, "c");
    expect(tokens.replace(4, 5, renamedDefinition, 3, 4).definitionMembershipChanges).toEqual(new Set(["b", "c"]));
    expect(tokens.hasDefinition("b")).toBe(false);
    expect(tokens.hasDefinition("c")).toBe(true);
  });

  it("removes provisional definition counts when truncating", () => {
    const tokens = new BlockTokenStream(2);
    pushToken(tokens, 0, 1, "a");
    pushToken(tokens, 1, 2, "b");

    tokens.truncate(1);

    expect(tokens.hasDefinition("a")).toBe(true);
    expect(tokens.hasDefinition("b")).toBe(false);
    tokens.reset(0);
    expect(tokens.hasDefinition("a")).toBe(false);
  });
});
