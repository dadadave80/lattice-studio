/**
 * The document store with real undo (contracts §5.1, spec L22 decision 10, Flow 9 L488-L494).
 *
 * Two zustand stores work together:
 * - the public store (`DocumentState`), which components read through `useDocument`;
 * - a history store wrapped in the vendored zundo `temporal` middleware. Its state is one `Snapshot`: the
 *   project's undoable part (`name`, `recipe`, `layout`, `provenance`, `labels`), the selection that went with it, and
 *   the label of the step that produced it. zundo keeps up to 200 past snapshots, one per gesture.
 *
 * `deploy` and `predicted` live only in the public project: `record` changes them without a step, and undo and
 * redo merge the restored snapshot over the current project, so they survive both. The session's selection is
 * written into the current snapshot just before history moves, so undo restores the selection from before the
 * step and redo the one from after it. Viewport, selection changes on their own, and everything else in the
 * session never enter history.
 */
import type { EditResult, Hex, Project, Recipe } from "@lattice-studio/core";
import { CORE_FACETS, lines } from "@lattice-studio/core";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  announce, DEFAULT_SETTINGS, log, now, session, type DocumentActions, type DocumentChange, type DocumentState,
  type DocumentStore, type EditOp,
} from "@/contracts";
import { temporal, type TemporalState } from "./vendor/zundo";

/** Undo steps kept per project, for the session (spec L494). */
export const HISTORY_LIMIT = 200;

/** Presses of one key closer together than this merge into one step (spec L475: "a burst of presses"). */
export const BURST_GAP_MS = 1000;

/** The part of a project that history covers (contracts §5.1), plus the ENS labels that go with its addresses (L462). */
export type Tracked = Pick<Project, "name" | "recipe" | "layout" | "provenance" | "labels">;

/** One history entry: the undoable part, its selection, and the label of the step that produced it. */
export type Snapshot = { tracked: Tracked; selection: string[]; label: string | null };

/** How the store reads and restores the selection; the session store by default. */
export type SelectionAccess = { get(): readonly string[]; set(selection: string[]): void };

export type DocumentStoreOptions = {
  /** The project before anything loads. Default: an empty untitled project. */
  initial?: Project;
  /** While it returns a reason, `apply`, `begin`, `burst`, `record`, `undo` and `redo` refuse. Default: the session's. */
  readOnly?: () => string | null;
  selection?: SelectionAccess;
  limit?: number;
};

/** The document store plus its history, for tests and the history commands. Never read `history` in render. */
export type HistoryDocumentStore = DocumentStore & {
  history: StoreApi<TemporalState<Snapshot>>;
  /**
   * Pins an unpinned recipe (a new project's zero placeholder) to the loaded catalog, in the document and in every
   * history entry, without an undo step; saved like a record. Returns whether anything changed.
   */
  pinCatalog(catalog: { tag: string; hash: Hex }): boolean;
};

/** A new project's catalog hash until the catalog loads: 32 zero bytes (K2's untitled project, CCR from S7a). */
export const UNPINNED_HASH: Hex = `0x${"00".repeat(32)}`;

/** True while a recipe names no catalog yet: an empty tag, or the zero placeholder hash. */
export function isUnpinned(recipe: Recipe): boolean {
  return recipe.catalog.tag === "" || /^0x(?:0{64})?$/.test(recipe.catalog.hash);
}

/**
 * An empty project, as the app starts before a project opens: core only (the loupe and ERC-165 facets, nothing
 * placed), with the empty step plan that keeps the automatic introspection step, as K2's untitled project.
 */
export function untitledProject(): Project {
  return {
    id: "untitled",
    name: "Untitled",
    recipe: {
      schemaVersion: 1,
      catalog: { tag: "", hash: UNPINNED_HASH },
      facets: [...CORE_FACETS],
      owners: {},
      exclude: [],
      init: { kind: "steps", steps: [] },
    },
    layout: {},
    deploy: { path: DEFAULT_SETTINGS.defaultPath, entropy: `0x${"00".repeat(11)}`, scope: "every-chain" },
    provenance: {},
    predicted: [],
  };
}

function pick(project: Project): Tracked {
  const { name, recipe, layout, provenance, labels } = project;
  return { name, recipe, layout, provenance, ...(labels === undefined ? {} : { labels }) };
}

/** `project` with the tracked part replaced; a snapshot without labels takes the key away (FX42 keeps none when empty). */
function merge(project: Project, tracked: Tracked): Project {
  const { labels: _current, ...rest } = project;
  const { name, recipe, layout, provenance, labels } = tracked;
  return { ...rest, name, recipe, layout, provenance, ...(labels === undefined ? {} : { labels }) };
}

function sameTracked(a: Tracked, b: Tracked): boolean {
  return a.name === b.name && a.recipe === b.recipe && a.layout === b.layout && a.provenance === b.provenance && a.labels === b.labels;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/** The selection, keeping only cards the project has. */
function onSheet(selection: readonly string[], project: Tracked): string[] {
  return selection.filter((name) => project.recipe.facets.includes(name) || Object.hasOwn(project.layout, name));
}

const sessionSelection: SelectionAccess = {
  get: () => session.get().selection,
  set: (selection) => session.set({ selection }),
};

export function createDocumentStore(options: DocumentStoreOptions = {}): HistoryDocumentStore {
  const readOnly = options.readOnly ?? (() => session.get().readOnly);
  const selection = options.selection ?? sessionSelection;
  const limit = options.limit ?? HISTORY_LIMIT;
  const initial = options.initial ?? untitledProject();

  const snapshots = createStore<Snapshot>()(
    temporal((): Snapshot => ({ tracked: pick(initial), selection: [], label: null }), { limit }),
  );
  const history = snapshots.temporal;
  const store = createStore<DocumentState>(() => ({
    project: initial,
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    lastChange: null,
  }));

  let revision = 0;
  /** The drag in progress: its label. History holds the snapshot from before it until `commit`. */
  let drag: { label: string } | null = null;
  /** The burst being merged: its key and the time of its last press. */
  let burst: { key: string; at: number } | null = null;

  const change = (kind: DocumentChange["kind"], label: string): DocumentChange => {
    revision += 1;
    return { kind, label, revision };
  };

  /** Changes the history store without recording a step. */
  const silently = (patch: Partial<Snapshot>): void => {
    history.getState().pause();
    try {
      snapshots.setState(patch);
    } finally {
      history.getState().resume();
    }
  };

  /** Writes the live selection into the current snapshot, so the step about to be left keeps it. */
  const keepSelection = (): void => {
    const live = selection.get();
    if (!sameList(snapshots.getState().selection, live)) silently({ selection: [...live] });
  };

  const labels = (): Pick<DocumentState, "canUndo" | "canRedo" | "undoLabel" | "redoLabel"> => {
    const { pastStates, futureStates } = history.getState();
    const canUndo = pastStates.length > 0;
    const next = futureStates.at(-1);
    return {
      canUndo,
      canRedo: futureStates.length > 0,
      undoLabel: canUndo ? snapshots.getState().label : null,
      redoLabel: next?.label ?? null,
    };
  };

  const publish = (project: Project, kind: DocumentChange["kind"], label: string): void => {
    store.setState({ project, ...labels(), lastChange: change(kind, label) });
  };

  const refuse = (reason: string): EditResult => {
    log({ tag: "Note", text: reason });
    return { project: store.getState().project, changed: false, summary: reason };
  };

  /** Records a step from the current snapshot to `next`. */
  const step = (label: string, next: Project, kind: DocumentChange["kind"]): void => {
    keepSelection();
    snapshots.setState({ tracked: pick(next), selection: [...selection.get()], label });
    publish(next, kind, label);
  };

  const commit = (): void => {
    if (!drag) return;
    const { label } = drag;
    drag = null;
    const project = store.getState().project;
    if (sameTracked(pick(project), snapshots.getState().tracked)) return;
    snapshots.setState({ tracked: pick(project), selection: [...selection.get()], label });
    publish(project, "edit", label);
  };

  const move = (direction: "undo" | "redo"): string | null => {
    const reason = readOnly();
    if (reason !== null) {
      refuse(reason);
      return null;
    }
    commit();
    burst = null;
    const temporalState = history.getState();
    const available = direction === "undo" ? temporalState.pastStates : temporalState.futureStates;
    if (available.length === 0) return null;
    keepSelection();
    const label = (direction === "undo" ? snapshots.getState().label : available.at(-1)?.label) ?? "the last change";
    if (direction === "undo") temporalState.undo();
    else temporalState.redo();
    const restored = snapshots.getState();
    const project = merge(store.getState().project, restored.tracked);
    const nextSelection = onSheet(restored.selection, restored.tracked);
    if (!sameList(selection.get(), nextSelection)) selection.set(nextSelection);
    publish(project, direction, label);
    const line = direction === "undo" ? lines.undid({ label }) : { tag: "Note" as const, dim: true as const, text: `Redid: ${label}.` };
    log(line);
    announce(line.text);
    return label;
  };

  const actions: DocumentActions = {
    apply(label, op) {
      const reason = readOnly();
      if (reason !== null) return refuse(reason);
      commit();
      burst = null;
      const result = op(store.getState().project);
      if (result.changed) step(label, result.project, "edit");
      return result;
    },
    begin(label) {
      const reason = readOnly();
      if (reason !== null) {
        refuse(reason);
        return;
      }
      commit();
      burst = null;
      keepSelection();
      drag = { label };
    },
    update(op: EditOp) {
      const current = store.getState().project;
      if (!drag) return { project: current, changed: false, summary: "No drag is in progress." };
      const reason = readOnly();
      if (reason !== null) return refuse(reason);
      const result = op(current);
      if (result.changed) store.setState({ project: result.project, lastChange: change("drag", drag.label) });
      return result;
    },
    commit,
    cancel() {
      if (!drag) return;
      const { label } = drag;
      drag = null;
      const current = store.getState().project;
      const base = snapshots.getState().tracked;
      if (!sameTracked(pick(current), base)) store.setState({ project: merge(current, base), lastChange: change("drag", label) });
    },
    burst(label, key, op) {
      const reason = readOnly();
      if (reason !== null) return refuse(reason);
      commit();
      const result = op(store.getState().project);
      if (!result.changed) return result;
      const at = now();
      if (burst && burst.key === key && at - burst.at <= BURST_GAP_MS && at >= burst.at) {
        silently({ tracked: pick(result.project) });
        store.setState({ project: result.project, lastChange: change("burst", snapshots.getState().label ?? label) });
        burst.at = at;
      } else {
        step(label, result.project, "burst");
        burst = { key, at };
      }
      return result;
    },
    record(label, op) {
      const reason = readOnly();
      if (reason !== null) return refuse(reason);
      const current = store.getState().project;
      const result = op(current);
      if (!result.changed) return result;
      // Only the settings outside history change here; anything else the op touched stays as it was.
      const project: Project = { ...current, deploy: result.project.deploy, predicted: result.project.predicted };
      store.setState({ project, lastChange: change("record", label) });
      return { ...result, project };
    },
    load(project, reason) {
      drag = null;
      burst = null;
      silently({ tracked: pick(project), selection: [], label: null });
      history.getState().clear();
      // A new document starts with the core deselected. The card selection is the project switch's to reset
      // (projects/cmd/shared.ts), as before; the history filter drops names that aren't on the new sheet.
      if (session.get().coreSelected) session.set({ coreSelected: false });
      publish(project, "load", reason ?? `Opened ${project.name}`);
      if (reason) log({ tag: "Note", text: reason });
    },
    undo: () => move("undo"),
    redo: () => move("redo"),
  };

  const pinCatalog = (catalog: { tag: string; hash: Hex }): boolean => {
    const project = store.getState().project;
    if (!isUnpinned(project.recipe)) return false;
    const pin = (recipe: Recipe): Recipe => (isUnpinned(recipe) ? { ...recipe, catalog: { tag: catalog.tag, hash: catalog.hash } } : recipe);
    const pinned = pin(project.recipe);
    // One recipe object for the document and the current entry, so a drag's commit still sees them as equal.
    const current = snapshots.getState().tracked;
    const currentRecipe = current.recipe === project.recipe ? pinned : pin(current.recipe);
    const pinEntry = (entry: Partial<Snapshot>): Partial<Snapshot> =>
      entry.tracked && isUnpinned(entry.tracked.recipe) ? { ...entry, tracked: { ...entry.tracked, recipe: pin(entry.tracked.recipe) } } : entry;
    const { pastStates, futureStates } = history.getState();
    history.setState({ pastStates: pastStates.map(pinEntry), futureStates: futureStates.map(pinEntry) });
    silently({ tracked: { ...current, recipe: currentRecipe } });
    store.setState({ project: { ...project, recipe: pinned }, lastChange: change("record", "Pinned the catalog") });
    return true;
  };

  return { store, actions, history, pinCatalog };
}
