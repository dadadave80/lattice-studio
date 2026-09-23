/**
 * Services (contracts §5.2): plain functions with a registration seam, so a module can call a service before
 * its implementing WP lands. K2's defaults buffer (log, announce, toast, banners: replayed into the real
 * implementation when it registers) or do the least that works (connection, deployments, escape stack).
 *
 * Implementations register with `provideServices` at module evaluation, before the app renders: hooks
 * (`useRegion`, `useOnline`, `useSaveStatus`) call whichever implementation is current when they run.
 */
import type {
  CommandRef, ConsoleLine, Deployment, LineDraft, Project, ProblemCode, Random, Recipe, Result,
} from "@lattice-studio/core";
import { NotImplemented } from "@lattice-studio/core";
import { useSyncExternalStore, type HTMLAttributes, type RefCallback } from "react";
import type { ChainService } from "./chain";
import type { DialogId, DialogProps } from "./dialogs";
import { REGION_LABELS, type RegionId } from "./regions";
import { doc, session, settings, type Viewport } from "./stores";

// ---------------------------------------------------------------------------------------------------------
// Types

export type AnnounceOptions = {
  politeness?: "polite" | "assertive";
  /** Announcements with the same key merge while they keep coming ("Moved ERC20 right" ×5 → one). */
  merge?: string;
};

export type ToastInput = {
  text: string;
  /** The toast's one action, run through the command registry ("Removed 2 facets" · Undo). */
  action?: CommandRef;
  /** Errors stay until closed (spec L733). */
  kind?: "info" | "error";
};

export type BannerProps = {
  text: string;
  tone?: "info" | "warning" | "error";
  /** Buttons, run through the command registry; labels come from each command's title. */
  actions?: CommandRef[];
  /** Shows a close button. */
  dismissible?: boolean;
};

/** Props for a region container: spread them onto the element (`<aside {...useRegion("inspector")}>`). */
export type RegionProps = HTMLAttributes<HTMLElement> & {
  ref?: RefCallback<HTMLElement>;
  "data-region": RegionId;
  "aria-label": string;
  tabIndex: number;
};

/** Esc handler. Return `false` to pass Esc to the next layer. */
export type EscapeHandler = () => boolean | void;

/** The title bar's save status (IR L66): "Saved", "Saving…", "Not saved" or "Read-only". */
export type SaveStatus = {
  state: "saved" | "saving" | "not-saved" | "read-only";
  text: string;
  /** What "click for details" shows. */
  detail?: string;
};

export type ProjectsService = {
  /** Creates a project around `recipe`, makes it the open document and saves it. */
  createProject(recipe: Recipe, name: string): Promise<Result<Project, string>>;
  /** Opens a stored project as the document. */
  openProject(id: string): Promise<Result<Project, string>>;
  saveStatus(): SaveStatus;
  subscribeSaveStatus(listener: (status: SaveStatus) => void): () => void;
  /** Per project, outside the document (spec L402). Null when none was saved. */
  loadViewport(id: string): Promise<Viewport | null>;
  saveViewport(id: string, viewport: Viewport): void;
};

export type DeploymentsService = {
  listDeployments(projectId: string): Promise<Deployment[]>;
  putDeployment(deployment: Deployment): Promise<void>;
};

/** A catalog row being dragged toward the sheet. */
export type CatalogDrag = { facet: string; pointerId: number; clientX: number; clientY: number };

/** Somewhere a catalog drag can drop (the sheet). */
export type DropTarget = {
  element: Element;
  over?(drag: CatalogDrag): void;
  leave?(drag: CatalogDrag): void;
  drop(drag: CatalogDrag): void;
};

export type DndService = {
  startCatalogDrag(facet: string, pointer: { pointerId: number; clientX: number; clientY: number }): void;
  /** Returns a disposer. */
  registerDropTarget(target: DropTarget): () => void;
  /** Subscribes to the drag in progress (S5a's ghost); null when none. */
  subscribeDrag(listener: (drag: CatalogDrag | null) => void): () => void;
};

export type ConnectionService = {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
};

/** Everything `provideServices` can replace. */
export type Services = {
  /** S5e. */
  log(line: ConsoleLine): void;
  /** S9. */
  announce(text: string, options?: AnnounceOptions): void;
  /** S10. */
  toast(input: ToastInput): void;
  /** S10 hosts; content from owners. */
  showBanner(id: string, props: BannerProps): void;
  hideBanner(id: string): void;
  /** S9. A hook: it may call other hooks. */
  useRegion(id: RegionId): RegionProps;
  /** S2. */
  pushEscape(handler: EscapeHandler): () => void;
  /** S7a. */
  projects: ProjectsService;
  /** S7a. */
  deployments: DeploymentsService;
  /** S8a: loads the lazy chain module. */
  chain(): Promise<ChainService>;
  /** S5a starts, S4e receives. */
  dnd: DndService;
  /** S12. */
  openProblemDoc(code: ProblemCode): void;
  /** S11a. */
  connection: ConnectionService;
  /** Milliseconds since the epoch; tests inject a fake clock. */
  now(): number;
  /** Random bytes; tests inject a seeded source. */
  randomBytes: Random;
};

// ---------------------------------------------------------------------------------------------------------
// K2's defaults

const LOG_BUFFER = 1000;
const SMALL_BUFFER = 50;

type Buffers = {
  log: ConsoleLine[];
  announce: [string, AnnounceOptions | undefined][];
  toast: ToastInput[];
  banners: Map<string, BannerProps>;
};

function push<T>(list: T[], item: T, cap: number): void {
  list.push(item);
  if (list.length > cap) list.splice(0, list.length - cap);
}

function notBuiltNote(wp: string): void {
  impl.log({ tag: "Note", text: `Not built yet · WP-${wp}`, at: new Date(impl.now()).toISOString() });
}

function listeners<T>(): { add(fn: (v: T) => void): () => void; emit(v: T): void } {
  const set = new Set<(v: T) => void>();
  return {
    add(fn) {
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(v) {
      for (const fn of set) fn(v);
    },
  };
}

function browserConnection(): ConnectionService {
  return {
    isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
    subscribe(listener) {
      if (typeof window === "undefined") return () => {};
      const on = () => listener(true);
      const off = () => listener(false);
      window.addEventListener("online", on);
      window.addEventListener("offline", off);
      return () => {
        window.removeEventListener("online", on);
        window.removeEventListener("offline", off);
      };
    },
  };
}

function memoryDeployments(): DeploymentsService {
  const records = new Map<string, Deployment>();
  return {
    listDeployments: async (projectId) => [...records.values()].filter((d) => d.projectId === projectId),
    putDeployment: async (d) => {
      records.set(`${d.chainId}:${d.address.toLowerCase()}`, d);
    },
  };
}

function hex(bytes: Uint8Array): `0x${string}` {
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function minimalProjects(): ProjectsService {
  const status: SaveStatus = { state: "not-saved", text: "Not saved", detail: "Not built yet · WP-S7a" };
  return {
    async createProject(recipe, name) {
      const project: Project = {
        id: hex(impl.randomBytes(16)).slice(2),
        name,
        recipe,
        layout: {},
        deploy: { path: settings.get().defaultPath, entropy: hex(impl.randomBytes(11)), scope: "every-chain" },
        provenance: {},
        predicted: [],
      };
      doc.load(project);
      return { ok: true, value: project };
    },
    async openProject() {
      return { ok: false, error: "Not built yet · WP-S7a" };
    },
    saveStatus: () => status,
    subscribeSaveStatus: () => () => {},
    loadViewport: async (id) => session.get().viewports[id] ?? null,
    saveViewport: (id, viewport) => {
      session.set((s) => ({ viewports: { ...s.viewports, [id]: viewport } }));
    },
  };
}

function minimalDnd(): DndService {
  const targets = new Set<DropTarget>();
  const drags = listeners<CatalogDrag | null>();
  return {
    startCatalogDrag(facet, pointer) {
      if (typeof window === "undefined") return;
      let drag: CatalogDrag = { facet, ...pointer };
      let over: DropTarget | null = null;
      const hit = (x: number, y: number): DropTarget | null => {
        const el = document.elementFromPoint(x, y);
        for (const t of targets) if (el && t.element.contains(el)) return t;
        return null;
      };
      const move = (e: PointerEvent) => {
        if (e.pointerId !== drag.pointerId) return;
        drag = { ...drag, clientX: e.clientX, clientY: e.clientY };
        const next = hit(e.clientX, e.clientY);
        if (next !== over) over?.leave?.(drag);
        over = next;
        over?.over?.(drag);
        drags.emit(drag);
      };
      const end = (e: PointerEvent) => {
        if (e.pointerId !== drag.pointerId) return;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        drag = { ...drag, clientX: e.clientX, clientY: e.clientY };
        const target = e.type === "pointerup" ? hit(e.clientX, e.clientY) : null;
        if (over && over !== target) over.leave?.(drag);
        target?.drop(drag);
        drags.emit(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      drags.emit(drag);
    },
    registerDropTarget(target) {
      targets.add(target);
      return () => targets.delete(target);
    },
    subscribeDrag: (listener) => drags.add(listener),
  };
}

function defaults(buffers: Buffers): Services {
  const escapes: EscapeHandler[] = [];
  return {
    log: (line) => push(buffers.log, line, LOG_BUFFER),
    announce: (text, options) => push(buffers.announce, [text, options], SMALL_BUFFER),
    toast: (input) => push(buffers.toast, input, SMALL_BUFFER),
    showBanner: (id, props) => void buffers.banners.set(id, props),
    hideBanner: (id) => void buffers.banners.delete(id),
    useRegion: (id) => ({
      role: "region",
      "aria-label": REGION_LABELS[id],
      "data-region": id,
      tabIndex: -1,
    }),
    pushEscape(handler) {
      escapes.push(handler);
      return () => {
        const at = escapes.lastIndexOf(handler);
        if (at >= 0) escapes.splice(at, 1);
      };
    },
    projects: minimalProjects(),
    deployments: memoryDeployments(),
    chain: () => Promise.reject(new NotImplemented("S8a", "chainService")),
    dnd: minimalDnd(),
    openProblemDoc: () => notBuiltNote("S12"),
    connection: browserConnection(),
    now: () => Date.now(),
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
  };
}

function freshBuffers(): Buffers {
  return { log: [], announce: [], toast: [], banners: new Map() };
}

let buffers = freshBuffers();
let impl: Services = defaults(buffers);

/**
 * Replaces services with real implementations. Buffered log lines, announcements, toasts and shown banners
 * are replayed into the new implementation. Returns a disposer that restores the previous services.
 */
export function provideServices(provided: Partial<Services>): () => void {
  const previous = impl;
  impl = { ...impl, ...provided };
  if (provided.log) for (const line of buffers.log.splice(0)) provided.log(line);
  if (provided.announce) for (const [text, options] of buffers.announce.splice(0)) provided.announce(text, options);
  if (provided.toast) for (const input of buffers.toast.splice(0)) provided.toast(input);
  if (provided.showBanner) {
    for (const [id, props] of buffers.banners) provided.showBanner(id, props);
    buffers.banners.clear();
  }
  return () => {
    // Put back only what this call provided and nobody has replaced since.
    const restored: Record<string, unknown> = { ...impl };
    for (const key of Object.keys(provided) as (keyof Services)[]) {
      if (impl[key] === provided[key]) restored[key] = previous[key];
    }
    impl = restored as Services;
  };
}

/** @internal The harness's reset between tests: K2's defaults, empty buffers. */
export function resetServices(): void {
  buffers = freshBuffers();
  impl = defaults(buffers);
}

/** @internal What the defaults have buffered so far (tests read it). */
export function bufferedServices(): Readonly<Buffers> {
  return buffers;
}

/** @internal Empties the buffers and keeps every registered implementation (the harness, between tests). */
export function clearServiceBuffers(): void {
  buffers.log.length = 0;
  buffers.announce.length = 0;
  buffers.toast.length = 0;
  buffers.banners.clear();
}

// ---------------------------------------------------------------------------------------------------------
// The calls

/** Milliseconds since the epoch, from the injected clock. */
export function now(): number {
  return impl.now();
}

/** Random bytes, from the injected source. */
export function randomBytes(n: number): Uint8Array {
  return impl.randomBytes(n);
}

/** Appends a console line. A draft without `at` is stamped with the injected clock. */
export function log(line: ConsoleLine | LineDraft): void {
  impl.log("at" in line ? line : { ...line, at: new Date(impl.now()).toISOString() });
}

export function announce(text: string, options?: AnnounceOptions): void {
  impl.announce(text, options);
}

export function toast(input: ToastInput): void {
  impl.toast(input);
}

export function showBanner(id: string, props: BannerProps): void {
  impl.showBanner(id, props);
}

export function hideBanner(id: string): void {
  impl.hideBanner(id);
}

/** Pushes `{ id, props }` onto the session's dialog stack. The dialog's owner renders it. */
export function openDialog(id: DialogId, props: DialogProps = {}): void {
  dialogKey += 1;
  const key = dialogKey;
  session.set((s) => ({ dialogs: [...s.dialogs, { id, props, key }] }));
}

/** Closes the topmost dialog with this id. */
export function closeDialog(id: DialogId): void {
  session.set((s) => {
    const at = s.dialogs.map((d) => d.id).lastIndexOf(id);
    return at < 0 ? {} : { dialogs: s.dialogs.filter((_, i) => i !== at) };
  });
}

let dialogKey = 0;

/** Props for a region container. A hook: call it in render. */
export function useRegion(id: RegionId): RegionProps {
  return impl.useRegion(id);
}

/** Pushes an Esc handler onto the stack; returns a disposer. */
export function pushEscape(handler: EscapeHandler): () => void {
  return impl.pushEscape(handler);
}

export function createProject(recipe: Recipe, name: string): Promise<Result<Project, string>> {
  return impl.projects.createProject(recipe, name);
}

export function openProject(id: string): Promise<Result<Project, string>> {
  return impl.projects.openProject(id);
}

export function saveStatus(): SaveStatus {
  return impl.projects.saveStatus();
}

/** The save status, re-rendering when it changes. */
export function useSaveStatus(): SaveStatus {
  return useSyncExternalStore(
    (onChange) => impl.projects.subscribeSaveStatus(onChange),
    () => impl.projects.saveStatus(),
  );
}

export function loadViewport(id: string): Promise<Viewport | null> {
  return impl.projects.loadViewport(id);
}

export function saveViewport(id: string, viewport: Viewport): void {
  impl.projects.saveViewport(id, viewport);
}

export function listDeployments(projectId: string): Promise<Deployment[]> {
  return impl.deployments.listDeployments(projectId);
}

export function putDeployment(deployment: Deployment): Promise<void> {
  return impl.deployments.putDeployment(deployment);
}

/**
 * The lazy chain module. Rejects with `NotImplemented` (`Not built yet · WP-S8a`) until S8a registers, and
 * with the import's error when the chunk can't load.
 */
export function chainService(): Promise<ChainService> {
  return impl.chain();
}

export function startCatalogDrag(facet: string, pointer: { pointerId: number; clientX: number; clientY: number }): void {
  impl.dnd.startCatalogDrag(facet, pointer);
}

export function registerDropTarget(target: DropTarget): () => void {
  return impl.dnd.registerDropTarget(target);
}

export function subscribeCatalogDrag(listener: (drag: CatalogDrag | null) => void): () => void {
  return impl.dnd.subscribeDrag(listener);
}

export function openProblemDoc(code: ProblemCode): void {
  impl.openProblemDoc(code);
}

export function isOnline(): boolean {
  return impl.connection.isOnline();
}

/** Whether the browser is online, re-rendering when it changes. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => impl.connection.subscribe(onChange),
    () => impl.connection.isOnline(),
  );
}
