import { describe, expect, test } from "bun:test";
import type { Catalog, Layout } from "@lattice-studio/core";
import { analyze } from "@lattice-studio/core";
import { loadFixtureCatalog, makeRecipe } from "@lattice-studio/core/testing";
import { overlayModel, type NoteEntry, type OverlayInputs } from "./overlay-model";
import { reuse, same } from "./stable";

const loaded = loadFixtureCatalog();
if (!loaded.ok) throw new Error(loaded.error);
const catalog: Catalog = loaded.value;

const FACETS = ["AxelarGatewayAdapter", "HyperlaneGatewayAdapter", "VaultCore", "GovernedDiamondCut"];
const recipe = makeRecipe({ facets: FACETS }, catalog);
const analysis = analyze(recipe, catalog);

const LAYOUT: Layout = {
  AxelarGatewayAdapter: { x: 0, y: 0, pins: "right" },
  HyperlaneGatewayAdapter: { x: 400, y: 0, pins: "left" },
  VaultCore: { x: 0, y: 640, pins: "right" },
  GovernedDiamondCut: { x: 800, y: 640, pins: "right" },
};

function inputs(layout: Layout): OverlayInputs {
  return { layout, recipe, catalog, analysis, compact: false, heights: {} };
}

function moved(name: string, dx: number, dy: number, layout: Layout = LAYOUT): Layout {
  const entry = layout[name];
  if (!entry) throw new Error(name);
  return { ...layout, [name]: { ...entry, x: entry.x + dx, y: entry.y + dy } };
}

const byId = (entries: readonly NoteEntry[], id: string): NoteEntry | undefined => entries.find((e) => e.note.id === id);

describe("overlay model (spec L816, L825)", () => {
  const placed = overlayModel().place(inputs(LAYOUT));
  const cardNote = placed.entries.find((e) => e.anchor.kind === "card" && e.anchor.facet === "VaultCore");
  const tieNote = placed.entries.find((e) => e.anchor.kind === "tie");

  test("the scene has a note on a card and a note on a tie", () => {
    expect(cardNote).toBeDefined();
    expect(tieNote).toBeDefined();
    expect(placed.edges.length).toBeGreaterThan(0);
  });

  test("following a drag that hasn't moved anything keeps every note's object", () => {
    const next = overlayModel().follow(placed, inputs(LAYOUT));
    next.entries.forEach((entry, i) => expect(entry).toBe(placed.entries[i] as NoteEntry));
  });

  test("a dragged card's note moves with it; notes anchored elsewhere keep their objects", () => {
    const next = overlayModel().follow(placed, inputs(moved("VaultCore", 48, -16)));
    const note = byId(next.entries, cardNote?.note.id ?? "");
    expect(note?.placement.rect).toEqual({ ...cardNote!.placement.rect, x: cardNote!.placement.rect.x + 48, y: cardNote!.placement.rect.y - 16 });
    expect(note?.placement.leader).toEqual(cardNote!.placement.leader.map((p) => ({ x: p.x + 48, y: p.y - 16 })));
    expect(note?.frame.x).toBe(cardNote!.frame.x + 48);
    for (const entry of placed.entries) {
      if (entry.note.id === cardNote?.note.id) continue;
      expect(byId(next.entries, entry.note.id)).toBe(entry);
    }
  });

  test("a tie's note moves by as much as the tie's midpoint", () => {
    const layout = moved("HyperlaneGatewayAdapter", 80, 40);
    const model = overlayModel();
    const next = model.follow(placed, inputs(layout));
    const tie = tieNote!.anchor.kind === "tie" ? tieNote!.anchor : null;
    const mid = next.edges.find((e) => e.id === tie?.trace)?.data?.mid;
    expect(mid).toBeDefined();
    const note = byId(next.entries, tieNote!.note.id);
    expect(note?.placement.rect.x).toBe(tieNote!.placement.rect.x + (mid!.x - tie!.at.x));
    expect(note?.placement.rect.y).toBe(tieNote!.placement.rect.y + (mid!.y - tie!.at.y));
  });

  test("the traces follow every move", () => {
    const layout = moved("VaultCore", 200, 0);
    expect(same(overlayModel().follow(placed, inputs(layout)).edges, overlayModel().place(inputs(layout)).edges)).toBe(true);
  });

  test("a drag back to where it began lands every note where it was", () => {
    const model = overlayModel();
    const away = model.follow(placed, inputs(moved("VaultCore", 96, 96)));
    expect(same(away.entries, placed.entries)).toBe(false);
    const back = model.follow(placed, inputs(LAYOUT));
    back.entries.forEach((entry, i) => expect(entry).toBe(placed.entries[i] as NoteEntry));
  });

  test("placing again after the drag is the same as placing from scratch", () => {
    const layout = moved("VaultCore", 400, 0);
    const model = overlayModel();
    model.place(inputs(LAYOUT));
    model.follow(placed, inputs(layout));
    expect(same(model.place(inputs(layout)), overlayModel().place(inputs(layout)))).toBe(true);
  });
});

describe("reuse and same", () => {
  test("a missing field equals one set to undefined", () => {
    expect(same({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(same({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(same([{ x: 1 }], [{ x: 1 }])).toBe(true);
    expect(same([1, 2], [1, 2, 3])).toBe(false);
    expect(same({ a: [1] }, { a: { 0: 1 } })).toBe(false);
  });

  test("an unchanged list comes back as the same array; a changed item alone is new", () => {
    const a = { id: "a", at: { x: 0 } };
    const b = { id: "b", at: { x: 0 } };
    const previous = [a, b];
    expect(reuse(previous, [{ id: "a", at: { x: 0 } }, { id: "b", at: { x: 0 } }], (i) => i.id)).toBe(previous);
    const next = reuse(previous, [{ id: "a", at: { x: 0 } }, { id: "b", at: { x: 8 } }], (i) => i.id);
    expect(next[0]).toBe(a);
    expect(next[1]).not.toBe(b);
    expect(next[1]).toEqual({ id: "b", at: { x: 8 } });
  });
});
