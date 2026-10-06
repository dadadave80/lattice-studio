import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EditResult, Project } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { createStore } from "zustand/vanilla";
import { bufferedServices } from "./services";
import {
  DEFAULT_SETTINGS, doc, history, initialSession, provideStores, session, settings, type DocumentChange,
  type DocumentState, type SessionState, type SettingsState,
} from "./stores";
import { isolateContracts } from "./test-support";

const rename = (name: string) => (p: Project): EditResult =>
  p.name === name
    ? { project: p, changed: false, summary: `Already named ${name}.` }
    : { project: { ...p, name }, changed: true, summary: `Renamed to ${name}` };

let restore: () => void;
beforeEach(() => {
  restore = isolateContracts();
  doc.load(makeProject({ name: "Vault" }));
});
afterEach(() => restore());

describe("K2's minimal document store", () => {
  test("apply changes the project and reports the op's result", () => {
    expect(doc.apply("Rename", rename("Treasury"))).toMatchObject({ changed: true, summary: "Renamed to Treasury" });
    expect(doc.get().name).toBe("Treasury");
    expect(doc.apply("Rename", rename("Treasury"))).toMatchObject({ changed: false, summary: "Already named Treasury." });
  });

  test("a drag updates live and cancel reverts it", () => {
    doc.begin("Move");
    doc.update(rename("A"));
    doc.update(rename("B"));
    expect(doc.get().name).toBe("B");
    doc.cancel();
    expect(doc.get().name).toBe("Vault");
    doc.begin("Move");
    doc.update(rename("C"));
    doc.commit();
    expect(doc.get().name).toBe("C");
  });

  test("no history before S1: undo and redo return null", () => {
    doc.apply("Rename", rename("X"));
    expect(history.canUndo).toBe(false);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });

  test("while read-only, apply, begin, burst and record change nothing and log the reason", () => {
    const reason = "Read-only: this project is open in another tab.";
    session.set({ readOnly: reason });
    for (const result of [doc.apply("Rename", rename("X")), doc.burst("Nudge", "k", rename("Y")), doc.record("Prediction", rename("Z"))]) {
      expect(result).toMatchObject({ changed: false, summary: reason });
    }
    doc.begin("Move");
    expect(doc.get().name).toBe("Vault");
    expect(bufferedServices().log.map((l) => l.text)).toEqual([reason, reason, reason, reason]);
  });
});

describe("doc.subscribe", () => {
  test("sees every change with what it was: edits, drags, bursts, records and loads", () => {
    const changes: (Omit<DocumentChange, "revision"> | null)[] = [];
    const stop = doc.subscribe((state) => {
      const c = state.lastChange;
      changes.push(c ? { kind: c.kind, label: c.label } : null);
    });
    doc.apply("Rename", rename("A"));
    doc.apply("Rename", rename("A")); // a no-op: nothing to save
    doc.begin("Move");
    doc.update(rename("B"));
    doc.commit();
    doc.burst("Nudge", "k", rename("C"));
    doc.record("Prediction", rename("D"));
    doc.load(makeProject({ name: "Other" }), "Took over editing from another tab.");
    stop();
    expect(changes).toEqual([
      { kind: "edit", label: "Rename" },
      { kind: "drag", label: "Move" },
      { kind: "edit", label: "Move" },
      { kind: "burst", label: "Nudge" },
      { kind: "record", label: "Prediction" },
      { kind: "load", label: "Took over editing from another tab." },
    ]);
  });

  test("revisions increase by one per change", () => {
    const start = doc.state().lastChange?.revision ?? 0;
    doc.apply("Rename", rename("A"));
    doc.record("Prediction", rename("B"));
    expect(doc.state().lastChange?.revision).toBe(start + 2);
  });
});

describe("subscriptions survive provideStores", () => {

  test("the core's facets never enter the card selection", () => {
    session.set({ selection: ["ERC20", "DiamondLoupeFacet", "ERC165Facet"] });
    expect(session.get().selection).toEqual(["ERC20"]);
    session.set(() => ({ selection: ["ERC165Facet"] }));
    expect(session.get().selection).toEqual([]);
  });

  test("a card selection deselects the core; core.select's own patch keeps it", () => {
    session.set({ coreSelected: true });
    session.set({ selection: ["ERC20"] });
    expect(session.get().coreSelected).toBe(false);
    session.set({ selection: [], coreSelected: true });
    expect(session.get().coreSelected).toBe(true);
    session.set(() => ({ selection: [] }));
    expect(session.get().coreSelected).toBe(false);
  });
  test("a listener attached to the minimal stores follows S1's stores", () => {
    const docNames: string[] = [];
    const chains: (number | null)[] = [];
    const wheels: string[] = [];
    const stops = [
      doc.subscribe((s) => docNames.push(s.project.name)),
      session.subscribe((s) => chains.push(s.chainId)),
      settings.subscribe((s) => wheels.push(s.wheel)),
    ];

    // S1 provides its own stores after these subscriptions were made.
    const replacementDoc = createStore<DocumentState>(() => ({
      project: makeProject({ name: "From S1" }), canUndo: true, canRedo: false, undoLabel: "Placed ERC20", redoLabel: null,
      lastChange: null,
    }));
    const replacementSession = createStore<SessionState>(() => ({ ...initialSession(), chainId: 84532 }));
    const replacementSettings = createStore<SettingsState>(() => ({ ...structuredClone(DEFAULT_SETTINGS), wheel: "zoom" }));
    const dispose = provideStores({
      document: { store: replacementDoc, actions: { ...doc } },
      session: replacementSession,
      settings: replacementSettings,
    });
    // The swap itself is a change.
    expect([docNames, chains, wheels]).toEqual([["From S1"], [84532], ["zoom"]]);
    expect(history.canUndo).toBe(true);

    // Later changes to the new stores reach the old listeners.
    replacementSession.setState({ chainId: 11155111 });
    replacementSettings.setState({ wheel: "pan" });
    replacementDoc.setState({ project: makeProject({ name: "Edited" }) });
    expect([docNames, chains, wheels]).toEqual([["From S1", "Edited"], [84532, 11155111], ["zoom", "pan"]]);

    // Writes through the facades go to the new stores.
    session.set({ chainId: 1 });
    expect(replacementSession.getState().chainId).toBe(1);

    dispose();
    expect(session.get().chainId).toBeNull();
    for (const stop of stops) stop();
  });

  test("a disposer puts back only what it provided", () => {
    const mine = createStore<SessionState>(() => ({ ...initialSession(), chainId: 11155111 }));
    const dispose = provideStores({ session: mine });
    const later = createStore<SessionState>(() => ({ ...initialSession(), chainId: 84532 }));
    const disposeLater = provideStores({ session: later });
    dispose();
    expect(session.get().chainId).toBe(84532);
    disposeLater();
    expect(session.get().chainId).toBe(11155111);
  });
});

describe("session and settings", () => {
  test("defaults per contracts §5.1", () => {
    expect(session.get()).toEqual(initialSession());
    expect(session.get().panes.left.size).toBe(240);
    expect(session.get().panes.inspector.size).toBe(316);
    expect(settings.get()).toEqual({ ...DEFAULT_SETTINGS });
    expect(settings.get().nudge).toEqual({ small: 8, large: 32 });
  });

  test("set merges; the inspector routes to typed views", () => {
    session.set((s) => ({ selection: [...s.selection, "ERC20"] }));
    session.set((s) => ({ panes: { ...s.panes, inspector: { ...s.panes.inspector, view: { kind: "init", focus: "bundle.p.asset" } } } }));
    expect(session.get().selection).toEqual(["ERC20"]);
    expect(session.get().panes.inspector.view).toEqual({ kind: "init", focus: "bundle.p.asset" });
  });
});
