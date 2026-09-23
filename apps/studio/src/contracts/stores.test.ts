import { beforeEach, describe, expect, test } from "bun:test";
import type { EditResult, Project } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { createStore } from "zustand/vanilla";
import { bufferedServices, resetServices } from "./services";
import {
  DEFAULT_SETTINGS, doc, history, initialSession, provideStores, resetStores, session, settings, type SessionState,
} from "./stores";

const rename = (name: string) => (p: Project): EditResult =>
  p.name === name
    ? { project: p, changed: false, summary: `Already named ${name}.` }
    : { project: { ...p, name }, changed: true, summary: `Renamed to ${name}` };

beforeEach(() => {
  resetServices();
  resetStores();
  doc.load(makeProject({ name: "Vault" }));
});

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

  test("burst and record change the document", () => {
    doc.burst("Nudge", "nudge", rename("N"));
    expect(doc.get().name).toBe("N");
    doc.record("Prediction", rename("R"));
    expect(doc.get().name).toBe("R");
  });

  test("no history before S1: undo and redo return null", () => {
    doc.apply("Rename", rename("X"));
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });

  test("while read-only, apply, begin, burst and record change nothing and log the reason", () => {
    const reason = "Read-only: this project is open in another tab.";
    session.set({ readOnly: reason });
    for (const result of [
      doc.apply("Rename", rename("X")),
      doc.burst("Nudge", "k", rename("Y")),
      doc.record("Prediction", rename("Z")),
    ]) {
      expect(result).toMatchObject({ changed: false, summary: reason });
    }
    doc.begin("Move");
    expect(doc.get().name).toBe("Vault");
    expect(bufferedServices().log.map((l) => l.text)).toEqual([reason, reason, reason, reason]);
  });

  test("load replaces the document and logs its reason", () => {
    doc.load(makeProject({ name: "Other" }), "Took over editing from another tab.");
    expect(doc.get().name).toBe("Other");
    expect(bufferedServices().log.map((l) => l.text)).toEqual(["Took over editing from another tab."]);
  });
});

describe("session and settings", () => {
  test("defaults per contracts §5.1", () => {
    expect(session.get()).toEqual(initialSession());
    expect(session.get().panes.left.size).toBe(240);
    expect(session.get().panes.inspector.size).toBe(316);
    expect(settings.get().nudge).toEqual({ small: 8, large: 32 });
    expect(settings.get().receiptTimeout).toBe(180);
    expect(settings.get()).toEqual({ ...DEFAULT_SETTINGS });
  });

  test("set merges and subscribers see the change", () => {
    const seen: (string | null)[] = [];
    const stop = session.subscribe((s) => seen.push(s.readOnly));
    session.set({ readOnly: "Read-only" });
    session.set((s) => ({ selection: [...s.selection, "ERC20"] }));
    stop();
    expect(session.get().selection).toEqual(["ERC20"]);
    expect(seen).toEqual(["Read-only", "Read-only"]);
  });
});

describe("provideStores", () => {
  test("replaces a store and its disposer puts back only what it provided", () => {
    const mine = createStore<SessionState>(() => ({ ...initialSession(), chainId: 11155111 }));
    const dispose = provideStores({ session: mine });
    expect(session.get().chainId).toBe(11155111);
    const later = createStore<SessionState>(() => ({ ...initialSession(), chainId: 84532 }));
    const disposeLater = provideStores({ session: later });
    dispose();
    expect(session.get().chainId).toBe(84532);
    disposeLater();
    expect(session.get().chainId).toBe(11155111);
  });
});
