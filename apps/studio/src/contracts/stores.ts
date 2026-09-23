/**
 * The three stores (contracts §5.1). K2 ships working minimal stores without history; S1 replaces their
 * internals through `provideStores` and keeps this API. Components read through narrow selectors only
 * (spec L902): `useDocument((s) => s.project.name)`, never the whole state.
 *
 * Every hook and every `subscribe` goes through a stable relay, so a subscription made before S1 provides
 * its stores (at module evaluation, or by a mounted component) follows the replacement: listeners are
 * called once with the new store's state and keep receiving its changes.
 */
import type {
  Address, Anchor, DeployPath, EditResult, Hex, Layout, ProblemCode, Project,
} from "@lattice-studio/core";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { DialogEntry } from "./dialogs";
import type { BindingId, KeySpec } from "./keys";
import { log } from "./kernel";

// ---------------------------------------------------------------------------------------------------------
// Document store (undoable)

/** An edit: core's `EditResult` op, applied to the current project (contracts §3.4 `edit`). */
export type EditOp = (project: Project) => EditResult;

/**
 * What last changed the document, for subscribers outside React (S7a's autosave and tab fan-out, S14's
 * catalog pin, S8c). `drag` is a live `update` inside `begin`/`commit`; the commit reports `edit`.
 * `revision` increases by one per change.
 */
export type DocumentChange = {
  kind: "edit" | "drag" | "burst" | "record" | "undo" | "redo" | "load";
  label: string;
  revision: number;
};

/** What the document store holds. History covers `name`, `recipe`, `layout` and `provenance`. */
export type DocumentState = {
  project: Project;
  canUndo: boolean;
  canRedo: boolean;
  /** The step Undo would revert ("Placed ERC20"), for menus and tooltips; null when there is none. */
  undoLabel: string | null;
  /** The step Redo would reapply; null when there is none. */
  redoLabel: string | null;
  /** Null until the first change. */
  lastChange: DocumentChange | null;
};

/**
 * Every way to change the document. While the session's read-only reason is set, `apply`, `begin`, `burst`
 * and `record` change nothing, log the reason and return it as the summary (`changed: false`). Every change
 * sets `lastChange`, so subscribers (autosave) see edits, records, undo, redo and loads alike.
 */
export type DocumentActions = {
  /** One undo step named `label`. A no-op (`changed: false`) adds no step. */
  apply(label: string, op: EditOp): EditResult;
  /** Starts a drag: `update` changes the document live, then `commit` makes one step or `cancel` reverts. */
  begin(label: string): void;
  update(op: EditOp): EditResult;
  commit(): void;
  cancel(): void;
  /** Key repeats: consecutive calls with the same `key` merge into one step while presses keep coming. */
  burst(label: string, key: string, op: EditOp): EditResult;
  /** Changes `deploy` or `predicted`: saved like any edit, but no undo step, and it survives undo and redo. */
  record(label: string, op: EditOp): EditResult;
  /** Replaces the document and clears history (open, new, migrate, take over); logs `reason` when given. */
  load(project: Project, reason?: string): void;
  /** Reverts the last step; returns its label, or null when history is empty. */
  undo(): string | null;
  /** Reapplies the last undone step; returns its label, or null when there's nothing to redo. */
  redo(): string | null;
};

/** A document store implementation: S1 provides one with history. */
export type DocumentStore = { store: StoreApi<DocumentState>; actions: DocumentActions };

// ---------------------------------------------------------------------------------------------------------
// Session store (never in history)

export type Tool = "select" | "hand";

/** A sheet viewport: React Flow's `{ x, y, zoom }`. */
export type Viewport = { x: number; y: number; zoom: number };

export type LeftTab = "catalog" | "structure";
export type ConsoleTab = "log" | "script" | "recipe";

/** The pane switcher under 768 px (spec L369). */
export type NarrowPane = "sheet" | "structure" | "catalog" | "inspector" | "console";

/**
 * What the inspector shows (IR L115-L126, spec L358). Null follows the selection: Diamond when nothing is
 * selected, Facet for one card, Selection for several. The others are routed to explicitly.
 */
export type InspectorView =
  | null
  /** Diamond view; `section: "deployments"` scrolls to the Deployments list (deployments.show, IR L68). */
  | { kind: "diamond"; section?: "deployments" | "authority" | "readiness" }
  /** Facet view of a placed facet; `focus: "selectors"` lands in its Selectors list (inspector.focusSelectors). */
  | { kind: "facet"; facet: string; focus?: "selectors" }
  | { kind: "selection" }
  /** Catalog preview (catalog.preview); `compare` lists the options shown side by side (Compare options…). */
  | { kind: "preview"; facet: string; compare?: string[] }
  /** Problem view by problem id. */
  | { kind: "problem"; id: string }
  /**
   * Init plan (Flow 7: init.open, init.focusField, Fill in). `focus` is an argument path ("bundle.p.asset"),
   * a step path ("steps[2]"), "examples" or "authority".
   */
  | { kind: "init"; focus?: string }
  /** A problem's doc page (openProblemDoc, Learn more); without `code`, the help index (help.open). */
  | { kind: "doc"; code?: ProblemCode }
  /** Comparison: the plan beside a deployed diamond's `facets()` (spec L576, IR L120; deploy.compare). */
  | { kind: "comparison"; chainId: number; address: Address }
  /** Confirm addresses… stepping through each From link or From file field in full (LINK-01, S13). */
  | { kind: "confirm-addresses"; path?: string };

export type SessionState = {
  /** Selected facet names. */
  selection: string[];
  /** What keyboard focus is on, as an anchor (a card, a pin, a problem's note). */
  focus: Anchor | null;
  tool: Tool;
  modes: {
    /** Init order mode (I). */
    initOrder: boolean;
    /** Move to… is placing the selection. */
    moveTo: boolean;
    /** The card whose selector rows have keyboard focus (Enter on a card), or null. */
    rows: string | null;
  };
  /** Per project id. S7a persists it outside the document; S4b restores it when a project opens. */
  viewports: Record<string, Viewport>;
  /** Drawer and tab state per region, and pane sizes in px (spec L353-L359). */
  panes: {
    left: { open: boolean; size: number; tab: LeftTab };
    inspector: { open: boolean; size: number; view: InspectorView };
    /** `size` is the body's height; `open` false shows the 36 px header only. */
    console: { open: boolean; size: number; tab: ConsoleTab; maximized: boolean };
    /** 1024-1279 px: the one side pane open as an overlay drawer. */
    drawer: "left" | "inspector" | null;
    /** Under 768 px: the pane the switcher shows. */
    narrow: NarrowPane;
  };
  /** Open dialogs, bottom first. */
  dialogs: DialogEntry[];
  /** The selected chain, or null. */
  chainId: number | null;
  /** While set, every document command is disabled with this reason (spec L389). */
  readOnly: string | null;
  /** Acknowledged problem ids, keyed by recipe hash. */
  acks: Record<Hex, string[]>;
};

/** A fresh session. */
export function initialSession(): SessionState {
  return {
    selection: [],
    focus: null,
    tool: "select",
    modes: { initOrder: false, moveTo: false, rows: null },
    viewports: {},
    panes: {
      left: { open: true, size: 240, tab: "catalog" },
      inspector: { open: true, size: 316, view: null },
      console: { open: true, size: 124, tab: "log", maximized: false },
      drawer: null,
      narrow: "sheet",
    },
    dialogs: [],
    chainId: null,
    readOnly: null,
    acks: {},
  };
}

// ---------------------------------------------------------------------------------------------------------
// Settings store

export type ThemeChoice = "shop" | "draft" | "system";

export type SettingsState = {
  theme: ThemeChoice;
  /** Follow the system, or force on or off (spec L631). */
  reduceMotion: "system" | "on" | "off";
  wheel: "pan" | "zoom";
  /** Arrow and ⇧arrow nudge, in px. */
  nudge: { small: number; large: number };
  minimap: boolean;
  /** Single-key shortcuts on or off (WCAG 2.1.4). */
  singleKeys: boolean;
  /** Remapped shortcuts by binding (`bindingId`); an empty list unbinds. Bindings not listed keep their defaults. */
  keymap: Partial<Record<BindingId, KeySpec[]>>;
  /** RPC URL overrides by chain id. */
  rpc: Record<number, string>;
  walletConnect: boolean;
  defaultPath: DeployPath;
  /** Seconds before a pending transaction shows as stale. */
  receiptTimeout: number;
  /** What deploy progress announces. */
  deployAnnouncements: "errors" | "all" | "none";
  /** Keep the console log across reloads. */
  keepLog: boolean;
};

export const DEFAULT_SETTINGS: Readonly<SettingsState> = Object.freeze<SettingsState>({
  theme: "system",
  reduceMotion: "system",
  wheel: "pan",
  nudge: { small: 8, large: 32 },
  minimap: false,
  singleKeys: true,
  keymap: {},
  rpc: {},
  walletConnect: false,
  defaultPath: "factory",
  receiptTimeout: 180,
  deployAnnouncements: "errors",
  keepLog: false,
});

// ---------------------------------------------------------------------------------------------------------
// K2's minimal stores

function untitledProject(): Project {
  return {
    id: "untitled",
    name: "Untitled",
    recipe: {
      schemaVersion: 1,
      catalog: { tag: "", hash: "0x" },
      facets: [],
      owners: {},
      exclude: [],
      init: { kind: "none" },
    },
    layout: {} satisfies Layout,
    deploy: { path: DEFAULT_SETTINGS.defaultPath, entropy: `0x${"00".repeat(11)}`, scope: "every-chain" },
    provenance: {},
    predicted: [],
  };
}

function refusal(project: Project, reason: string): EditResult {
  log({ tag: "Note", text: reason });
  return { project, changed: false, summary: reason };
}

function minimalDocumentStore(readOnlyReason: () => string | null): DocumentStore {
  const store = createStore<DocumentState>(() => ({
    project: untitledProject(),
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    lastChange: null,
  }));
  let base: Project | null = null;
  let dragLabel = "";
  let revision = 0;

  const change = (kind: DocumentChange["kind"], label: string): DocumentChange => {
    revision += 1;
    return { kind, label, revision };
  };
  const run = (kind: DocumentChange["kind"], label: string, op: EditOp): EditResult => {
    const current = store.getState().project;
    const reason = readOnlyReason();
    if (reason !== null) return refusal(current, reason);
    const result = op(current);
    if (result.changed) store.setState({ project: result.project, lastChange: change(kind, label) });
    return result;
  };

  const actions: DocumentActions = {
    apply: (label, op) => run("edit", label, op),
    begin: (label) => {
      const reason = readOnlyReason();
      if (reason !== null) {
        refusal(store.getState().project, reason);
        return;
      }
      base = store.getState().project;
      dragLabel = label;
    },
    update: (op) => run("drag", dragLabel, op),
    commit: () => {
      if (base && base !== store.getState().project) store.setState({ lastChange: change("edit", dragLabel) });
      base = null;
    },
    cancel: () => {
      if (base && base !== store.getState().project) store.setState({ project: base, lastChange: change("drag", dragLabel) });
      base = null;
    },
    burst: (label, _key, op) => run("burst", label, op),
    record: (label, op) => run("record", label, op),
    load: (project, reason) => {
      base = null;
      store.setState({
        project, canUndo: false, canRedo: false, undoLabel: null, redoLabel: null,
        lastChange: change("load", reason ?? `Opened ${project.name}`),
      });
      if (reason) log({ tag: "Note", text: reason });
    },
    undo: () => null,
    redo: () => null,
  };
  return { store, actions };
}

type Stores = {
  document: DocumentStore;
  session: StoreApi<SessionState>;
  settings: StoreApi<SettingsState>;
};

/** A stable store that forwards to whichever store is current, and re-attaches when it's replaced. */
type Relay<S> = { api: StoreApi<S>; point(next: StoreApi<S>): void };

function relay<S>(initial: StoreApi<S>): Relay<S> {
  let target = initial;
  const listeners = new Set<(state: S, previous: S) => void>();
  const fanout = (state: S, previous: S) => {
    for (const listener of Array.from(listeners)) listener(state, previous);
  };
  let detach = target.subscribe(fanout);
  const api: StoreApi<S> = {
    getState: () => target.getState(),
    getInitialState: () => target.getInitialState(),
    setState: ((partial: never, replace: never) => target.setState(partial, replace)) as StoreApi<S>["setState"],
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    api,
    point(next) {
      if (next === target) return;
      const previous = target.getState();
      detach();
      target = next;
      detach = target.subscribe(fanout);
      const state = target.getState();
      if (state !== previous) fanout(state, previous);
    },
  };
}

function minimalStores(): Stores {
  const session = createStore<SessionState>(() => initialSession());
  const settings = createStore<SettingsState>(() => structuredClone(DEFAULT_SETTINGS));
  return { session, settings, document: minimalDocumentStore(() => session.getState().readOnly) };
}

let current: Stores = minimalStores();
const relays = {
  document: relay(current.document.store),
  session: relay(current.session),
  settings: relay(current.settings),
};

function point(next: Stores): void {
  current = next;
  relays.document.point(next.document.store);
  relays.session.point(next.session);
  relays.settings.point(next.settings);
}

/**
 * Replaces one or more stores (S1). Call it at module evaluation, in the module's `services.ts`. Hooks and
 * subscriptions made earlier follow the replacement. Returns a disposer that puts back only what this call
 * provided and nobody has replaced since.
 */
export function provideStores(stores: Partial<Stores>): () => void {
  const previous = current;
  point({ ...current, ...stores });
  return () => {
    const restored = { ...current };
    if (stores.document && current.document === stores.document) restored.document = previous.document;
    if (stores.session && current.session === stores.session) restored.session = previous.session;
    if (stores.settings && current.settings === stores.settings) restored.settings = previous.settings;
    point(restored);
  };
}

/** @internal Fresh minimal stores (contract tests). Returns a disposer that restores the previous ones. */
export function resetStores(): () => void {
  const previous = current;
  point(minimalStores());
  return () => point(previous);
}

// ---------------------------------------------------------------------------------------------------------
// Facades and hooks

type Patch<S> = Partial<S> | ((state: S) => Partial<S>);

/** Non-reactive access to a store, for commands, services and tests. Never call `get()` in render. */
export type StoreAccess<S> = {
  get(): S;
  set(patch: Patch<S>): void;
  subscribe(listener: (state: S, previous: S) => void): () => void;
};

/**
 * The document store's actions, plus non-reactive reads and a subscription that outlives store replacement.
 * `subscribe` sees every change; read `state.lastChange` for what it was.
 */
export const doc: DocumentActions & {
  get(): Project;
  state(): DocumentState;
  subscribe(listener: (state: DocumentState, previous: DocumentState) => void): () => void;
} = {
  get: () => relays.document.api.getState().project,
  state: () => relays.document.api.getState(),
  subscribe: (listener) => relays.document.api.subscribe(listener),
  apply: (label, op) => current.document.actions.apply(label, op),
  begin: (label) => current.document.actions.begin(label),
  update: (op) => current.document.actions.update(op),
  commit: () => current.document.actions.commit(),
  cancel: () => current.document.actions.cancel(),
  burst: (label, key, op) => current.document.actions.burst(label, key, op),
  record: (label, op) => current.document.actions.record(label, op),
  load: (project, reason) => current.document.actions.load(project, reason),
  undo: () => current.document.actions.undo(),
  redo: () => current.document.actions.redo(),
};

/**
 * Undo and redo (contracts §5.1). `canUndo` and `canRedo` are non-reactive reads; render with
 * `useDocument((s) => s.canUndo)`. `subscribe` is `doc.subscribe`.
 */
export const history: {
  undo(): string | null;
  redo(): string | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  subscribe(listener: (state: DocumentState, previous: DocumentState) => void): () => void;
} = {
  undo: () => current.document.actions.undo(),
  redo: () => current.document.actions.redo(),
  get canUndo() {
    return relays.document.api.getState().canUndo;
  },
  get canRedo() {
    return relays.document.api.getState().canRedo;
  },
  subscribe: (listener) => relays.document.api.subscribe(listener),
};

export const session: StoreAccess<SessionState> = {
  get: () => relays.session.api.getState(),
  set: (patch) => relays.session.api.setState(patch),
  subscribe: (listener) => relays.session.api.subscribe(listener),
};

export const settings: StoreAccess<SettingsState> = {
  get: () => relays.settings.api.getState(),
  set: (patch) => relays.settings.api.setState(patch),
  subscribe: (listener) => relays.settings.api.subscribe(listener),
};

export function useDocument<T>(selector: (state: DocumentState) => T): T {
  return useStore(relays.document.api, selector);
}

export function useSession<T>(selector: (state: SessionState) => T): T {
  return useStore(relays.session.api, selector);
}

export function useSettings<T>(selector: (state: SettingsState) => T): T {
  return useStore(relays.settings.api, selector);
}
