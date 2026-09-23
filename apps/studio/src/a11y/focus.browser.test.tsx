import type { EditResult, Layout, Project } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createStore } from "zustand/vanilla";
import {
  doc, history, provideStores, session, type DocumentActions, type DocumentChange, type DocumentState,
} from "@/contracts";
import { onCleanup, renderWithStudio } from "../../test/harness";
import { resetAnnouncer } from "./announcer";
import { captureInvoker, focusAfterDelete, provideCardFocus } from "./focus";
import { RegionFrame } from "./testing/RegionFrame";

afterEach(() => {
  resetAnnouncer();
});

function at(x: number, y: number): Layout[string] {
  return { x, y, pins: "right" };
}

/** Two rows: ERC20 · ERC4626 · Vault, then Pausable. */
const LAYOUT: Layout = { ERC20: at(0, 0), ERC4626: at(320, 0), Vault: at(640, 0), Pausable: at(0, 400) };

function without(layout: Layout, names: string[]): Layout {
  return Object.fromEntries(Object.entries(layout).filter(([name]) => !names.includes(name)));
}

function remove(names: string[]): (p: Project) => EditResult {
  return (p) => ({ project: { ...p, layout: without(p.layout, names) }, changed: true, summary: `Removed ${names.join(", ")}` });
}

/** A document store with a real undo stack (K2's minimal one doesn't undo), provided for the test. */
function undoableDocument(): void {
  const store = createStore<DocumentState>(() => ({
    project: makeProject(), canUndo: false, canRedo: false, undoLabel: null, redoLabel: null, lastChange: null,
  }));
  const past: Project[] = [];
  const future: Project[] = [];
  let revision = 0;
  const change = (kind: DocumentChange["kind"], label: string): DocumentChange => ({ kind, label, revision: ++revision });
  const actions: DocumentActions = {
    apply: (label, op) => {
      const result = op(store.getState().project);
      if (result.changed) {
        past.push(store.getState().project);
        future.length = 0;
        store.setState({ project: result.project, canUndo: true, lastChange: change("edit", label) });
      }
      return result;
    },
    begin: () => {}, update: (op) => op(store.getState().project), commit: () => {}, cancel: () => {},
    burst: (label, _key, op) => actions.apply(label, op),
    record: (label, op) => actions.apply(label, op),
    load: (project) => store.setState({ project, lastChange: change("load", "Opened") }),
    undo: () => {
      const previous = past.pop();
      if (!previous) return null;
      future.push(store.getState().project);
      store.setState({ project: previous, lastChange: change("undo", "Undid") });
      return "Undid";
    },
    redo: () => {
      const next = future.pop();
      if (!next) return null;
      past.push(store.getState().project);
      store.setState({ project: next, lastChange: change("redo", "Redid") });
      return "Redid";
    },
  };
  onCleanup(provideStores({ document: { store, actions } }));
}

async function focusOn(name: string): Promise<void> {
  await page.getByRole("group", { name, exact: true }).click();
  await expect.element(page.getByRole("group", { name, exact: true })).toHaveFocus();
}

describe("focus after delete", () => {
  test("the next card in reading order", async () => {
    await renderWithStudio(<RegionFrame />, { project: makeProject({ layout: LAYOUT }) });
    await focusOn("ERC4626");
    doc.apply("Removed ERC4626", remove(["ERC4626"]));
    await expect.element(page.getByRole("group", { name: "Vault" })).toHaveFocus();
    expect(session.get().focus).toEqual({ kind: "facet", facet: "Vault" });
  });

  test("the next card wraps to the next row", async () => {
    await renderWithStudio(<RegionFrame />, { project: makeProject({ layout: LAYOUT }) });
    await focusOn("Vault");
    doc.apply("Removed Vault", remove(["Vault"]));
    await expect.element(page.getByRole("group", { name: "Pausable" })).toHaveFocus();
  });

  test("else the previous one", async () => {
    await renderWithStudio(<RegionFrame />, { project: makeProject({ layout: LAYOUT }) });
    await focusOn("Pausable");
    doc.apply("Removed Pausable", remove(["Pausable"]));
    await expect.element(page.getByRole("group", { name: "Vault" })).toHaveFocus();
  });

  test("else the sheet", async () => {
    await renderWithStudio(<RegionFrame />, { project: makeProject({ layout: { ERC20: at(0, 0) } }) });
    await focusOn("ERC20");
    doc.apply("Removed ERC20", remove(["ERC20"]));
    await expect.element(page.getByRole("region", { name: "Sheet", exact: true })).toHaveFocus();
    expect(session.get().focus).toBeNull();
  });

  test("a removal elsewhere leaves focus where it is", async () => {
    await renderWithStudio(<RegionFrame />, { project: makeProject({ layout: LAYOUT }) });
    await page.getByRole("button", { name: "Console control" }).click();
    doc.apply("Removed ERC20", remove(["ERC20"]));
    await expect.element(page.getByRole("button", { name: "Console control" })).toHaveFocus();
  });

  test("the helper, called directly, gives the same answer", async () => {
    await renderWithStudio(<RegionFrame />, { project: makeProject({ layout: without(LAYOUT, ["ERC20", "ERC4626"]) }) });
    expect(await focusAfterDelete(["ERC20", "ERC4626"], LAYOUT)).toBe("Vault");
    await expect.element(page.getByRole("group", { name: "Vault" })).toHaveFocus();
  });
});

describe("focus after undo and redo", () => {
  test("undo focuses the restored card; redo moves on from it again", async () => {
    undoableDocument();
    await renderWithStudio(<RegionFrame />, { project: makeProject({ layout: LAYOUT }) });
    await focusOn("ERC4626");
    doc.apply("Removed ERC4626", remove(["ERC4626"]));
    await expect.element(page.getByRole("group", { name: "Vault" })).toHaveFocus();

    await page.getByRole("button", { name: "Inspector control" }).click();
    history.undo();
    await expect.element(page.getByRole("group", { name: "ERC4626" })).toHaveFocus();

    history.redo();
    await expect.element(page.getByRole("group", { name: "Vault" })).toHaveFocus();
  });

  test("undoing a move focuses the card that moved back", async () => {
    undoableDocument();
    await renderWithStudio(<RegionFrame />, { project: makeProject({ layout: LAYOUT }) });
    doc.apply("Moved Pausable", (p) => ({ project: { ...p, layout: { ...p.layout, Pausable: at(320, 400) } }, changed: true, summary: "Moved Pausable" }));
    await page.getByRole("button", { name: "Title bar control" }).click();
    history.undo();
    await expect.element(page.getByRole("group", { name: "Pausable" })).toHaveFocus();
  });

  test("an undo that brings nothing back leaves focus where it is", async () => {
    undoableDocument();
    await renderWithStudio(<RegionFrame />, { project: makeProject({ layout: LAYOUT }) });
    doc.apply("Renamed", (p) => ({ project: { ...p, name: "Vault project" }, changed: true, summary: "Renamed" }));
    await page.getByRole("button", { name: "Title bar control" }).click();
    history.undo();
    await expect.element(page.getByRole("button", { name: "Title bar control" })).toHaveFocus();
  });
});

describe("the card focus seam", () => {
  test("S4e can pan first: its focuser is used", async () => {
    const asked: string[] = [];
    onCleanup(provideCardFocus((facet) => {
      asked.push(facet);
      document.querySelector<HTMLElement>(`[data-id="${facet}"]`)?.focus();
      return true;
    }));
    await renderWithStudio(<RegionFrame />, { project: makeProject({ layout: LAYOUT }) });
    await focusOn("ERC20");
    doc.apply("Removed ERC20", remove(["ERC20"]));
    expect(asked).toEqual(["ERC4626"]);
    await expect.element(page.getByRole("group", { name: "ERC4626" })).toHaveFocus();
  });
});

describe("return to invoker", () => {
  test("focus goes back to what opened the popover", async () => {
    await renderWithStudio(<RegionFrame />);
    await page.getByRole("button", { name: "Inspector control" }).click();
    const back = captureInvoker();
    await userEvent.keyboard("{F6}");
    await expect.element(page.getByRole("region", { name: "Console" })).toHaveFocus();
    expect(back()).toBe(true);
    await expect.element(page.getByRole("button", { name: "Inspector control" })).toHaveFocus();
  });

  test("when the invoker is gone, focus goes to the sheet", async () => {
    await renderWithStudio(<RegionFrame />);
    const gone = document.createElement("button");
    document.body.append(gone);
    gone.focus();
    const back = captureInvoker();
    gone.remove();
    expect(back()).toBe(false);
    await expect.element(page.getByRole("region", { name: "Sheet", exact: true })).toHaveFocus();
  });
});
