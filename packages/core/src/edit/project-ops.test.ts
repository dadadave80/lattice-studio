import { describe, expect, test } from "bun:test";
import { recipeHash } from "../canonical/hash";
import type { EditResult, Project } from "../model/project";
import { applyLayout, flipPins, moveCards, recordPrediction, renameProject, setCardPosition, setExpanded } from "./project-ops";
import { ADDRESS, catalog, changedIssues, deepFreeze, noOpIssues, projectWith } from "./testkit";

/** Runs `op` on a frozen deep copy, so any mutation of the input throws, and checks the input survived. */
function untouched<T>(project: Project, op: (p: Project) => T): T {
  const copy = structuredClone(project);
  const snapshot = structuredClone(project);
  const result = op(deepFreeze(copy));
  expect(copy).toEqual(snapshot);
  return result;
}

function expectChanged(result: EditResult, before: Project, summary: string): Project {
  expect(changedIssues(result, before, summary)).toEqual([]);
  return result.project;
}

function expectNoOp(result: EditResult, before: Project, summary: string): void {
  expect(noOpIssues(result, before, summary)).toEqual([]);
}

const base = projectWith(
  { facets: ["ERC20", "GovernedVault", "Receive"], owners: { "0x06fdde03": "ERC20" }, immutable: true },
  { name: "Grant vault" },
);

/** Layout and project ops never touch the recipe: the same object, so the same hash. */
function expectRecipeKept(result: EditResult, before: Project): void {
  expect(result.project.recipe).toBe(before.recipe);
  expect(recipeHash(result.project.recipe, catalog)).toBe(recipeHash(before.recipe, catalog));
}

describe("the core", () => {
  test("setCardPosition refuses a core facet: it has no card", () => {
    const withCore = { ...base, recipe: { ...base.recipe, facets: [...base.recipe.facets, "DiamondLoupeFacet", "ERC165Facet"] } };
    expectNoOp(setCardPosition(withCore, "DiamondLoupeFacet", { x: 8, y: 8 }), withCore, "DiamondLoupeFacet is the diamond's core and has no card.");
    expectNoOp(setCardPosition(withCore, "ERC165Facet", { x: Number.NaN, y: 8 }), withCore, "ERC165Facet is the diamond's core and has no card.");
    expect(Object.keys(withCore.layout)).not.toContain("DiamondLoupeFacet");
  });

  test("applyLayout drops the core's entries: alone they change nothing, beside others they're left out", () => {
    const stale = { ...base.layout, DiamondLoupeFacet: { x: 999, y: 999, pins: "right" as const }, ERC165Facet: { x: 0, y: 0, pins: "left" as const, expanded: true as const } };
    expectNoOp(applyLayout(base, stale), base, "Nothing moved: the sheet already has this layout.");
    const moved = { ...stale, ERC20: { x: 1600, y: 0, pins: "right" as const } };
    untouched(base, (p) => applyLayout(p, moved));
    const result = applyLayout(base, moved);
    const after = expectChanged(result, base, "Arranged ERC20");
    expect(Object.keys(after.layout).sort()).toEqual(Object.keys(base.layout).sort());
    expect(after.layout.ERC20).toEqual({ x: 1600, y: 0, pins: "right" });
    expectRecipeKept(result, base);
  });
});

describe("renameProject", () => {
  test("renames, trimmed", () => {
    const result = renameProject(base, "  Vault two ");
    expect(expectChanged(result, base, "Renamed the project to Vault two").name).toBe("Vault two");
    expectRecipeKept(result, base);
  });

  test("an empty or unchanged name does nothing", () => {
    expectNoOp(renameProject(base, "   "), base, "A project needs a name.");
    expectNoOp(renameProject(base, "Grant vault"), base, "The project is already called Grant vault.");
  });
});

describe("moveCards", () => {
  test("moves every named card by the offset, once each", () => {
    const result = moveCards(base, ["ERC20", "Receive", "ERC20"], { x: 8, y: -16 });
    const after = expectChanged(result, base, "Moved 2 cards");
    untouched(base, (p) => moveCards(p, ["ERC20", "Receive"], { x: 8, y: -16 }));
    expect(after.layout.ERC20).toEqual({ x: 8, y: -16, pins: "right" });
    expect(after.layout.Receive).toEqual({ x: 648, y: -16, pins: "right" });
    expect(after.layout.GovernedVault).toBe(base.layout.GovernedVault);
    expectRecipeKept(result, base);
    expect(base.layout.ERC20).toEqual({ x: 0, y: 0, pins: "right" });
  });

  test("one card is named", () => {
    expectChanged(moveCards(base, ["ERC20"], { x: 8, y: 0 }), base, "Moved ERC20");
  });

  test("says why nothing moved", () => {
    expectNoOp(moveCards(base, [], { x: 8, y: 0 }), base, "Select a card to move.");
    expectNoOp(moveCards(base, ["Vault"], { x: 8, y: 0 }), base, "Vault isn't on the sheet.");
    expectNoOp(moveCards(base, ["ERC20"], { x: 0, y: 0 }), base, "Nothing moved: the offset is zero.");
    expectNoOp(moveCards(base, ["ERC20"], { x: Number.POSITIVE_INFINITY, y: 0 }), base, "Nothing moved: the offset isn't a number.");
  });
});

describe("setCardPosition", () => {
  test("puts the card at the point", () => {
    const result = setCardPosition(base, "GovernedVault", { x: 40, y: 80 });
    const after = expectChanged(result, base, "Moved GovernedVault");
    expect(after.layout.GovernedVault).toEqual({ x: 40, y: 80, pins: "right" });
    expectRecipeKept(result, base);
  });

  test("gives a placed facet with no card yet an entry with pins on the right", () => {
    const { Receive: _receive, ...rest } = base.layout;
    const before: Project = { ...base, layout: rest };
    const after = setCardPosition(before, "Receive", { x: 8, y: 8 }).project;
    expect(after.layout.Receive).toEqual({ x: 8, y: 8, pins: "right" });
  });

  test("says why nothing moved", () => {
    expectNoOp(setCardPosition(base, "Vault", { x: 0, y: 0 }), base, "Vault isn't on the sheet.");
    expectNoOp(setCardPosition(base, "ERC20", { x: 0, y: 0 }), base, "ERC20 is already there.");
    expectNoOp(setCardPosition(base, "ERC20", { x: Number.NaN, y: 0 }), base, "ERC20 didn't move: the position isn't a number.");
  });
});

describe("flipPins", () => {
  test("flips each card's pin column", () => {
    const result = flipPins(base, ["ERC20"]);
    const after = expectChanged(result, base, "Flipped pins on ERC20");
    untouched(base, (p) => flipPins(p, ["ERC20", "Receive"]));
    expect(after.layout.ERC20?.pins).toBe("left");
    expectRecipeKept(result, base);
    const back = flipPins(after, ["ERC20", "Receive"]);
    expect(back.summary).toBe("Flipped pins on 2 cards");
    expect(back.project.layout.ERC20?.pins).toBe("right");
    expect(back.project.layout.Receive?.pins).toBe("left");
  });

  test("says why nothing flipped", () => {
    expectNoOp(flipPins(base, []), base, "Select a card to flip its pins.");
    expectNoOp(flipPins(base, ["Vault", "Axelar"]), base, "Vault and Axelar aren't on the sheet.");
  });
});

describe("setExpanded", () => {
  test("sets the flag, and collapsing removes it", () => {
    const result = setExpanded(base, "GovernedVault", true);
    const expanded = expectChanged(result, base, "Expanded GovernedVault");
    untouched(base, (p) => setExpanded(p, "GovernedVault", true));
    untouched(expanded, (p) => setExpanded(p, "GovernedVault", false));
    expect(expanded.layout.GovernedVault).toEqual({ x: 320, y: 0, pins: "right", expanded: true });
    expectRecipeKept(result, base);
    expectNoOp(setExpanded(expanded, "GovernedVault", true), expanded, "GovernedVault is already expanded.");
    const collapsed = expectChanged(setExpanded(expanded, "GovernedVault", false), expanded, "Collapsed GovernedVault");
    expect(collapsed.layout.GovernedVault).toEqual({ x: 320, y: 0, pins: "right" });
    expect(collapsed.layout.ERC20).toBe(expanded.layout.ERC20);
  });

  test("moves no other card: pushing cards below is the caller's composition", () => {
    const after = setExpanded(base, "ERC20", true).project;
    for (const name of ["GovernedVault", "Receive"]) expect(after.layout[name]).toBe(base.layout[name]);
  });

  test("says why nothing changed", () => {
    expectNoOp(setExpanded(base, "ERC20", false), base, "ERC20 is already collapsed.");
    expectNoOp(setExpanded(base, "Vault", true), base, "Vault isn't on the sheet.");
  });
});

describe("applyLayout", () => {
  test("replaces the layout and counts the cards that changed", () => {
    const layout: Project["layout"] = {
      ERC20: { x: 0, y: 0, pins: "right" },
      GovernedVault: { x: 0, y: 200, pins: "left", expanded: true },
      Receive: { x: 0, y: 400, pins: "right" },
    };
    const result = applyLayout(base, layout);
    const after = expectChanged(result, base, "Arranged 2 cards");
    untouched(base, (p) => applyLayout(p, deepFreeze(structuredClone(layout))));
    expect(after.layout).toEqual(layout);
    expect(after.layout).not.toBe(layout);
    expectRecipeKept(result, base);
  });

  test("the same layout is a no-op, and a position that isn't a number is refused", () => {
    expectNoOp(applyLayout(base, structuredClone(base.layout)), base, "Nothing moved: the sheet already has this layout.");
    const bad = { ...base.layout, ERC20: { x: Number.NaN, y: 0, pins: "right" as const } };
    expectNoOp(applyLayout(base, bad), base, "The layout wasn't applied: ERC20's position isn't a number.");
  });

  test("a card added or dropped counts as changed", () => {
    const { Receive: _receive, ...rest } = base.layout;
    expectChanged(applyLayout(base, rest), base, "Arranged Receive");
  });
});

describe("recordPrediction", () => {
  test("appends the address, checksummed, and never twice for a chain", () => {
    const result = recordPrediction(base, { chainId: 11155111, address: ADDRESS.toLowerCase() as `0x${string}` });
    const after = expectChanged(result, base, "Recorded 0x71C7…976F on chain 11155111");
    untouched(base, (p) => recordPrediction(p, { chainId: 1, address: ADDRESS }));
    expect(after.predicted).toEqual([{ chainId: 11155111, address: ADDRESS }]);
    expectRecipeKept(result, base);
    expectNoOp(recordPrediction(after, { chainId: 11155111, address: ADDRESS }), after, "0x71C7…976F on chain 11155111 is already recorded.");
    const other = recordPrediction(after, { chainId: 1, address: ADDRESS });
    expect(other.project.predicted).toEqual([
      { chainId: 11155111, address: ADDRESS },
      { chainId: 1, address: ADDRESS },
    ]);
  });

  test("refuses what isn't a chain id or an address", () => {
    expectNoOp(recordPrediction(base, { chainId: 0, address: ADDRESS }), base, "0 isn't a chain id.");
    expectNoOp(recordPrediction(base, { chainId: 1, address: "0x1234" }), base, "0x1234 isn't an address.");
  });
});
