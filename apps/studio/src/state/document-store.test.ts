import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EditResult, Project } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { doc, history, session, setCatalogStatus } from "@/contracts";
import { bufferedServices } from "@/contracts/services";
import { BURST_GAP_MS, HISTORY_LIMIT, isUnpinned, UNPINNED_HASH } from "./document-store";
import { settle, setupKit, type Kit } from "./testing";

const rename = (name: string) => (p: Project): EditResult =>
  p.name === name ? { project: p, changed: false, summary: `Already ${name}.` } : { project: { ...p, name }, changed: true, summary: `Renamed to ${name}` };

const move = (dx: number) => (p: Project): EditResult => ({
  project: { ...p, layout: { ...p.layout, A: { x: (p.layout.A?.x ?? 0) + dx, y: 0, pins: "right" } } },
  changed: true,
  summary: "Moved A",
});

const predict = (address: `0x${string}`) => (p: Project): EditResult => ({
  project: { ...p, predicted: [...p.predicted, { chainId: 11155111, address }] },
  changed: true,
  summary: "Recorded",
});

let kit: Kit;
beforeEach(() => {
  kit = setupKit({ project: makeProject({ name: "Vault", recipe: makeRecipe() }) });
});
afterEach(() => kit.dispose());

describe("undo and redo", () => {
  test("one step per apply, labelled; a no-op adds none", () => {
    expect(history.canUndo).toBe(false);
    doc.apply("Renamed to A", rename("A"));
    doc.apply("Renamed to A", rename("A"));
    expect(doc.state()).toMatchObject({ canUndo: true, canRedo: false, undoLabel: "Renamed to A", redoLabel: null });
    expect(kit.state.document.history.getState().pastStates).toHaveLength(1);
    expect(doc.undo()).toBe("Renamed to A");
    expect(doc.get().name).toBe("Vault");
    expect(doc.state()).toMatchObject({ canUndo: false, canRedo: true, redoLabel: "Renamed to A" });
    expect(doc.redo()).toBe("Renamed to A");
    expect(doc.get().name).toBe("A");
    expect(doc.undo()).toBe("Renamed to A");
    expect(doc.undo()).toBeNull();
  });

  test("undo logs a dim \"Undid:\" line and announces it; redo says Redid", () => {
    doc.apply("Placed ERC20", rename("A"));
    doc.undo();
    doc.redo();
    const lines = bufferedServices().log.slice(-2);
    expect(lines[0]).toMatchObject({ tag: "Note", dim: true, text: "Undid: Placed ERC20." });
    expect(lines[1]).toMatchObject({ tag: "Note", dim: true, text: "Redid: Placed ERC20." });
    expect(bufferedServices().announce.map(([text]) => text)).toEqual(["Undid: Placed ERC20.", "Redid: Placed ERC20."]);
  });

  test("a new step clears the redo stack", () => {
    doc.apply("A", rename("A"));
    doc.undo();
    doc.apply("B", rename("B"));
    expect(history.canRedo).toBe(false);
    expect(doc.redo()).toBeNull();
  });

  test("history keeps 200 steps", () => {
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) doc.apply(`Step ${i}`, rename(`N${i}`));
    let undone = 0;
    while (doc.undo() !== null) undone += 1;
    expect(undone).toBe(HISTORY_LIMIT);
    expect(doc.get().name).toBe("N5");
  });
});

describe("gestures", () => {
  test("a drag is one step; updates show live; cancel reverts without a step", () => {
    doc.begin("Moved A");
    doc.update(move(8));
    doc.update(move(8));
    doc.update(move(8));
    expect(doc.get().layout.A?.x).toBe(24);
    expect(doc.state().lastChange?.kind).toBe("drag");
    doc.commit();
    expect(doc.state().lastChange?.kind).toBe("edit");
    expect(kit.state.document.history.getState().pastStates).toHaveLength(1);
    doc.begin("Moved A");
    doc.update(move(8));
    doc.cancel();
    expect(doc.get().layout.A?.x).toBe(24);
    expect(kit.state.document.history.getState().pastStates).toHaveLength(1);
    expect(doc.undo()).toBe("Moved A");
    expect(doc.get().layout.A).toBeUndefined();
  });

  test("key bursts merge into one step while presses keep coming", () => {
    for (let i = 0; i < 5; i++) {
      doc.burst("Nudged A", "nudge", move(8));
      kit.clock.now += 100;
    }
    expect(kit.state.document.history.getState().pastStates).toHaveLength(1);
    expect(doc.get().layout.A?.x).toBe(40);
    kit.clock.now += BURST_GAP_MS + 1;
    doc.burst("Nudged A", "nudge", move(8));
    expect(kit.state.document.history.getState().pastStates).toHaveLength(2);
    doc.burst("Flipped", "other", move(1));
    expect(kit.state.document.history.getState().pastStates).toHaveLength(3);
    doc.undo();
    doc.undo();
    expect(doc.get().layout.A?.x).toBe(40);
    doc.undo();
    expect(doc.get().layout.A).toBeUndefined();
  });

  test("another edit ends a burst", () => {
    doc.burst("Nudged A", "nudge", move(8));
    doc.apply("Renamed", rename("X"));
    doc.burst("Nudged A", "nudge", move(8));
    expect(kit.state.document.history.getState().pastStates).toHaveLength(3);
  });
});

describe("ENS labels (spec L462)", () => {
  const SAFE = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
  const OTHER = "0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db";
  /** What an address field's commit does: the address in the recipe and, when it came from a name, the label. */
  const setSafe = (address: `0x${string}`, name: string | null) => (p: Project): EditResult => {
    const { labels: _old, ...rest } = p;
    const labels = name === null ? {} : { "steps[0].safe": name };
    const recipe = { ...p.recipe, init: { kind: "steps" as const, steps: [{ spec: "SafeDiamondCutInit", args: { safe: address } }] } };
    return { project: { ...rest, recipe, ...(name === null ? {} : { labels }) }, changed: true, summary: "Set Safe" };
  };
  const safeArg = (): unknown => {
    const init = doc.get().recipe.init;
    return init.kind === "steps" ? init.steps[0]?.args.safe : undefined;
  };

  test("undo takes the label back with the address, and redo brings both again", () => {
    doc.apply("Set Safe", setSafe(SAFE, null));
    doc.apply("Set Safe to safe.eth", setSafe(OTHER, "safe.eth"));
    expect(doc.get().labels).toEqual({ "steps[0].safe": "safe.eth" });
    doc.undo();
    expect(safeArg()).toBe(SAFE);
    expect("labels" in doc.get()).toBe(false);
    doc.redo();
    expect(safeArg()).toBe(OTHER);
    expect(doc.get().labels).toEqual({ "steps[0].safe": "safe.eth" });
    doc.apply("Set Safe", setSafe(SAFE, null));
    expect("labels" in doc.get()).toBe(false);
    doc.undo();
    expect(doc.get().labels).toEqual({ "steps[0].safe": "safe.eth" });
  });

  test("an edit that changes only a label is a step of its own", () => {
    doc.apply("Set Safe", setSafe(SAFE, null));
    doc.apply("Set Safe to safe.eth", setSafe(SAFE, "safe.eth"));
    expect(kit.state.document.history.getState().pastStates).toHaveLength(2);
    expect(doc.undo()).toBe("Set Safe to safe.eth");
    expect("labels" in doc.get()).toBe(false);
  });

  test("a drag that changes only a label commits one step, and cancel takes the label back", () => {
    doc.apply("Set Safe", setSafe(SAFE, null));
    doc.begin("Named Safe");
    doc.update(setSafe(SAFE, "safe.eth"));
    doc.commit();
    expect(kit.state.document.history.getState().pastStates).toHaveLength(2);
    doc.begin("Unnamed Safe");
    doc.update(setSafe(SAFE, null));
    expect("labels" in doc.get()).toBe(false);
    doc.cancel();
    expect(doc.get().labels).toEqual({ "steps[0].safe": "safe.eth" });
    expect(kit.state.document.history.getState().pastStates).toHaveLength(2);
  });
});

describe("selection and session", () => {
  test("each step keeps its selection: undo restores the one before, redo the one after", () => {
    const place = (name: string) => (p: Project): EditResult => ({
      project: { ...p, recipe: { ...p.recipe, facets: [...p.recipe.facets, name] }, layout: { ...p.layout, [name]: { x: 0, y: 0, pins: "right" } } },
      changed: true,
      summary: `Placed ${name}`,
    });
    doc.apply("Placed A", place("A"));
    session.set({ selection: ["A"] });
    doc.apply("Placed B", place("B"));
    session.set({ selection: ["B"] });
    doc.undo();
    expect(session.get().selection).toEqual(["A"]);
    doc.redo();
    expect(session.get().selection).toEqual(["B"]);
    // A restored selection never names a card the restored document doesn't have.
    session.set({ selection: ["A", "B"] });
    doc.undo();
    doc.undo();
    expect(session.get().selection).toEqual([]);
  });

  test("selection, viewport and every other session change stay out of history", () => {
    session.set({ selection: ["A"], viewports: { p: { x: 1, y: 2, zoom: 1 } }, tool: "hand" });
    session.set({ selection: [] });
    expect(history.canUndo).toBe(false);
    expect(kit.state.document.history.getState().pastStates).toHaveLength(0);
  });
});

describe("record", () => {
  test("changes deploy and predicted without a step, and survives undo and redo", () => {
    doc.apply("Renamed", rename("A"));
    doc.record("Recorded", predict("0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db"));
    expect(doc.state().lastChange?.kind).toBe("record");
    expect(kit.state.document.history.getState().pastStates).toHaveLength(1);
    doc.undo();
    expect(doc.get().name).toBe("Vault");
    expect(doc.get().predicted).toHaveLength(1);
    doc.redo();
    expect(doc.get().name).toBe("A");
    expect(doc.get().predicted).toHaveLength(1);
  });

  test("keeps only deploy and predicted from its op", () => {
    doc.record("Sneaky", (p) => ({ project: { ...p, name: "Other", deploy: { ...p.deploy, path: "createx" } }, changed: true, summary: "x" }));
    expect(doc.get().name).toBe("Vault");
    expect(doc.get().deploy.path).toBe("createx");
  });
});

describe("read-only", () => {
  test("apply, begin, burst, record, undo and redo change nothing and log the reason", () => {
    doc.apply("Renamed", rename("A"));
    const reason = "Another tab is editing this project.";
    session.set({ readOnly: reason });
    kit.clearLines();
    const results = [
      doc.apply("Renamed", rename("X")),
      doc.burst("Nudged", "k", move(8)),
      doc.record("Recorded", predict("0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db")),
    ];
    for (const r of results) expect(r).toMatchObject({ changed: false, summary: reason });
    doc.begin("Moved");
    expect(doc.update(move(8)).changed).toBe(false);
    expect(doc.undo()).toBeNull();
    expect(doc.redo()).toBeNull();
    expect(doc.get()).toMatchObject({ name: "A", predicted: [] });
    expect(doc.get().layout).toEqual({});
    expect(kit.texts()).toEqual([reason, reason, reason, reason, reason, reason]);
  });
});

describe("load", () => {
  test("replaces the document, clears history and logs the reason", () => {
    doc.apply("Renamed", rename("A"));
    doc.load(makeProject({ id: "other", name: "Other" }), "Took over editing: undo history starts here.");
    expect(doc.state()).toMatchObject({ canUndo: false, canRedo: false, lastChange: { kind: "load" } });
    expect(doc.undo()).toBeNull();
    expect(bufferedServices().log.at(-1)?.text).toBe("Took over editing: undo history starts here.");
  });

  test("a load deselects the core and leaves the card selection to the project switch", () => {
    session.set({ selection: [], coreSelected: true });
    expect(session.get().coreSelected).toBe(true);
    doc.load(makeProject({ id: "third", name: "Third" }));
    expect(session.get().coreSelected).toBe(false);
    session.set({ selection: ["A"] });
    doc.load(makeProject({ id: "other", name: "Other" }));
    expect(session.get().selection).toEqual(["A"]);
  });

  test("every change bumps lastChange.revision", () => {
    const seen: number[] = [];
    const stop = doc.subscribe((s) => {
      if (s.lastChange) seen.push(s.lastChange.revision);
    });
    doc.apply("A", rename("A"));
    doc.record("R", predict("0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db"));
    doc.undo();
    doc.redo();
    stop();
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(4);
  });
});

describe("catalog pin", () => {
  test("an unpinned project is pinned to the loaded catalog without an undo step", async () => {
    kit.dispose();
    kit = setupKit({ project: makeProject({ recipe: makeRecipe({ catalog: { tag: "", hash: UNPINNED_HASH } }) }) });
    await settle();
    expect(doc.get().recipe.catalog).toEqual({ tag: kit.catalog.lattice.tag, hash: kit.catalog.hash });
    expect(doc.state()).toMatchObject({ canUndo: false, lastChange: { kind: "record" } });
  });

  test("a read-only tab doesn't pin", async () => {
    kit.dispose();
    kit = setupKit({ project: makeProject({ recipe: makeRecipe({ catalog: { tag: "", hash: UNPINNED_HASH } }) }) });
    session.set({ readOnly: "Another tab is editing this project." });
    await settle();
    expect(doc.get().recipe.catalog.hash).toBe(UNPINNED_HASH);
  });

  test("an edit before the catalog loads never comes back unpinned: pin rewrites past and future history", async () => {
    kit.dispose();
    // No catalog yet: setupKit's own pinning check has nothing to pin against.
    kit = setupKit({ project: makeProject({ recipe: makeRecipe({ catalog: { tag: "", hash: UNPINNED_HASH } }) }), catalog: null });
    doc.apply("Renamed to A", rename("A"));
    doc.apply("Renamed to B", rename("B"));
    doc.undo(); // A step still undone (a future entry) when the catalog loads and pins.
    expect(doc.get().recipe.catalog.hash).toBe(UNPINNED_HASH);

    setCatalogStatus({ status: "ready", id: kit.catalog.lattice.tag, catalog: kit.catalog, manifest: null });
    await settle();
    const pinned = { tag: kit.catalog.lattice.tag, hash: kit.catalog.hash };
    expect(doc.get().recipe.catalog).toEqual(pinned);

    // Every past and future entry is rewritten too, not just the current document.
    const { pastStates, futureStates } = kit.state.document.history.getState();
    expect(pastStates.length).toBeGreaterThan(0);
    expect(futureStates.length).toBeGreaterThan(0);
    for (const entry of [...pastStates, ...futureStates]) {
      const tracked = entry.tracked;
      if (!tracked) throw new Error("a history entry has no tracked state");
      expect(isUnpinned(tracked.recipe)).toBe(false);
      expect(tracked.recipe.catalog).toEqual(pinned);
    }

    // No move, in either direction, ever brings back the zero hash or the empty tag.
    expect(doc.redo()).toBe("Renamed to B");
    expect(doc.get().name).toBe("B");
    expect(doc.get().recipe.catalog).toEqual(pinned);
    expect(doc.undo()).toBe("Renamed to B");
    expect(doc.get().name).toBe("A");
    expect(doc.get().recipe.catalog).toEqual(pinned);
    expect(doc.undo()).toBe("Renamed to A");
    expect(doc.get().name).toBe("Untitled");
    expect(doc.get().recipe.catalog).toEqual(pinned);
  });
});
