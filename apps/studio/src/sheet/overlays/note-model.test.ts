import { describe, expect, test } from "bun:test";
import type { Catalog, Hex4, Recipe } from "@lattice-studio/core";
import { analyze } from "@lattice-studio/core";
import { loadFixtureCatalog, makeRecipe } from "@lattice-studio/core/testing";
import { arrivalOrder, buildNotes, collisionCaption, COLLISION_RULE, noteOf } from "./note-model";
import { stepProblem } from "./problem-order";

const loaded = loadFixtureCatalog();
if (!loaded.ok) throw new Error(loaded.error);
const catalog: Catalog = loaded.value;

const SEND: Hex4 = "0xcdfe7f5c";
const ATTRIBUTE: Hex4 = "0xdc680a0f";

function recipe(facets: string[], input: Partial<Recipe> = {}): Recipe {
  return makeRecipe({ facets, ...input }, catalog);
}

function notesFor(facets: string[], input: Partial<Recipe> = {}) {
  const analysis = analyze(recipe(facets, input), catalog);
  return { analysis, notes: buildNotes(analysis, catalog) };
}

describe("collision notes (spec L434-L436, PA bug 22)", () => {
  test("Axelar and Hyperlane make one note for their two contested selectors", () => {
    const { analysis, notes } = notesFor(["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"]);
    const collisions = notes.filter((n) => n.kind === "collision");
    expect(collisions).toHaveLength(1);
    const [note] = collisions;
    expect(note?.id).toBe("collision:AxelarGatewayAdapter+HyperlaneGatewayAdapter");
    expect(note?.caption).toBe("Selector collision · 2");
    expect(note?.text).toBe(COLLISION_RULE);
    expect(note?.contenders).toEqual(["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"]);
    expect(note?.selectors.map((s) => s.hex).sort()).toEqual([SEND, ATTRIBUTE].sort());
    expect(note?.selectors.find((s) => s.hex === SEND)?.signature).toBe("sendMessage(bytes,bytes,bytes[])");
    const ids = analysis.problems.filter((p) => p.code === "SEL-01").map((p) => p.id);
    expect(note?.problemIds).toEqual(ids);
  });

  test("one note per contested set: three contenders on two selectors, two on a third", () => {
    const { notes } = notesFor(["AxelarGatewayAdapter", "CCIPGatewayAdapter", "HyperlaneGatewayAdapter"]);
    const collisions = notes.filter((n) => n.kind === "collision");
    const three = collisions.find((n) => n.contenders.length === 3);
    expect(three?.contenders).toEqual(["AxelarGatewayAdapter", "CCIPGatewayAdapter", "HyperlaneGatewayAdapter"]);
    expect(three?.selectors.map((s) => s.hex).sort()).toEqual([SEND, ATTRIBUTE].sort());
    const pair = collisions.find((n) => n.id === "collision:CCIPGatewayAdapter+HyperlaneGatewayAdapter");
    expect(pair?.selectors.map((s) => s.hex)).toEqual(["0x58d14c04"]);
    expect(pair?.caption).toBe("Selector collision");
    // Every SEL-01 belongs to exactly one note.
    const all = collisions.flatMap((n) => n.problemIds);
    expect(new Set(all).size).toBe(all.length);
  });

  test("an owner chosen for one selector leaves the other in the note", () => {
    const { notes } = notesFor(["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"], { owners: { [SEND]: "AxelarGatewayAdapter" } });
    const [note] = notes.filter((n) => n.kind === "collision");
    expect(note?.caption).toBe("Selector collision");
    expect(note?.selectors.map((s) => s.hex)).toEqual([ATTRIBUTE]);
  });

  test("Keep and Route: the card already on the sheet comes first, so the newcomer is the one being decided", () => {
    const facets = ["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"];
    const analysis = analyze(recipe(facets), catalog);
    // Hyperlane was on the sheet; Axelar is the newcomer.
    const arrived = arrivalOrder(arrivalOrder([], ["HyperlaneGatewayAdapter"]), recipe(facets).facets);
    expect(arrived).toEqual(["HyperlaneGatewayAdapter", "AxelarGatewayAdapter"]);
    const [note] = buildNotes(analysis, catalog, arrived).filter((n) => n.kind === "collision");
    expect(note?.contenders).toEqual(["HyperlaneGatewayAdapter", "AxelarGatewayAdapter"]);
    // The note keeps its id (catalog order), so it stays the same object across edits.
    expect(note?.id).toBe("collision:AxelarGatewayAdapter+HyperlaneGatewayAdapter");
    expect(note?.facets).toEqual(facets);
  });

  test("three contenders follow their arrival too; facets that arrived together keep catalog order", () => {
    const facets = ["AxelarGatewayAdapter", "CCIPGatewayAdapter", "HyperlaneGatewayAdapter"];
    const arrived = arrivalOrder(["HyperlaneGatewayAdapter"], recipe(facets).facets);
    const [three] = buildNotes(analyze(recipe(facets), catalog), catalog, arrived).filter((n) => n.contenders.length === 3);
    expect(three?.contenders).toEqual(["HyperlaneGatewayAdapter", "AxelarGatewayAdapter", "CCIPGatewayAdapter"]);
  });

  test("arrival order: kept places, newcomers last, a facet that left and came back is new", () => {
    const start = arrivalOrder([], ["A", "B"]);
    expect(start).toEqual(["A", "B"]);
    expect(arrivalOrder(start, ["A", "B"])).toBe(start);
    const placed = arrivalOrder(["B"], ["A", "B"]);
    expect(placed).toEqual(["B", "A"]);
    const removed = arrivalOrder(placed, ["A"]);
    expect(removed).toEqual(["A"]);
    expect(arrivalOrder(removed, ["A", "B"])).toEqual(["A", "B"]);
    expect(arrivalOrder(["B", "A"], ["C"])).toEqual(["C"]);
  });

  test("the caption counts only when there are several", () => {
    expect(collisionCaption(1)).toBe("Selector collision");
    expect(collisionCaption(3)).toBe("Selector collision · 3");
  });
});

describe("seam, missing dependency and convention notes", () => {
  test("DEP-01: VaultCore without ERC4626 offers Place ERC4626 beside VaultCore", () => {
    const { notes } = notesFor(["VaultCore"]);
    const note = notes.find((n) => n.kind === "missing");
    expect(note?.caption).toBe("Missing dependency");
    expect(note?.facets).toEqual(["VaultCore"]);
    expect(note?.text).toBe("VaultCore requires ERC4626: it runs the assets behind ERC4626's shares and initializes after it.");
    expect(note?.fixes).toContainEqual({ id: "facet.place", args: { facet: "ERC4626" } });
  });

  test("SEM-01: a stale owner outside the seam gets a seam note with Route and Remove", () => {
    const { notes } = notesFor(["ERC20", "ERC20Votes", "ERC20Pausable"], { owners: { "0xa9059cbb": "ERC20Pausable" } });
    const note = notes.find((n) => n.kind === "seam");
    expect(note?.caption).toBe("Seam");
    expect(note?.facets).toEqual(["ERC20Pausable"]);
    expect(note?.fixes.map((f) => f.id)).toEqual(["selector.route", "facet.remove"]);
  });

  test("DEP-02: a convention is a quieter note with Place", () => {
    const { notes } = notesFor(["GovernedDiamondCut"]);
    const note = notes.find((n) => n.kind === "convention");
    expect(note?.severity).toBe("warning");
    expect(note?.facets).toEqual(["GovernedDiamondCut"]);
    expect(note?.fixes).toContainEqual({ id: "facet.place", args: { facet: "EmergencyStop" } });
  });

  test("noteOf finds the note that stands for a problem; other problems have none", () => {
    const { analysis, notes } = notesFor(["AxelarGatewayAdapter", "HyperlaneGatewayAdapter", "VaultCore"]);
    for (const problem of analysis.problems) {
      const note = noteOf(notes, problem.id);
      if (["SEL-01", "SEM-01", "DEP-01", "DEP-02"].includes(problem.code)) expect(note?.problemIds).toContain(problem.id);
      else expect(note).toBeUndefined();
    }
  });

  test("notes come in the order of their first problem", () => {
    const { analysis, notes } = notesFor(["AxelarGatewayAdapter", "HyperlaneGatewayAdapter", "VaultCore", "GovernedDiamondCut"]);
    const firstIndex = notes.map((n) => analysis.problems.findIndex((p) => p.id === n.problemIds[0]));
    expect(firstIndex).toEqual([...firstIndex].sort((a, b) => a - b));
  });
});

describe("F8 order (spec L300)", () => {
  const ids = ["a", "b", "c"];

  test("walks forward and back, wrapping", () => {
    expect(stepProblem(ids, null, 1)).toBe("a");
    expect(stepProblem(ids, null, -1)).toBe("c");
    expect(stepProblem(ids, { id: "a", index: 0 }, 1)).toBe("b");
    expect(stepProblem(ids, { id: "c", index: 2 }, 1)).toBe("a");
    expect(stepProblem(ids, { id: "a", index: 0 }, -1)).toBe("c");
  });

  test("a resolved problem's place goes to the one that took it", () => {
    expect(stepProblem(["a", "c"], { id: "b", index: 1 }, 1)).toBe("c");
    expect(stepProblem(["a", "c"], { id: "b", index: 1 }, -1)).toBe("a");
    expect(stepProblem(["a"], { id: "b", index: 1 }, 1)).toBe("a");
  });

  test("nothing when there are no problems", () => {
    expect(stepProblem([], null, 1)).toBeUndefined();
  });

  test("F8 from nowhere visits every problem once, in analysis order", () => {
    const { analysis } = notesFor(["AxelarGatewayAdapter", "HyperlaneGatewayAdapter", "VaultCore", "GovernedDiamondCut"]);
    const order = analysis.problems.map((p) => p.id);
    const visited: string[] = [];
    let cursor: { id: string; index: number } | null = null;
    for (let i = 0; i < order.length; i++) {
      const next = stepProblem(order, cursor, 1);
      if (next === undefined) break;
      visited.push(next);
      cursor = { id: next, index: order.indexOf(next) };
    }
    expect(visited).toEqual(order);
  });
});
