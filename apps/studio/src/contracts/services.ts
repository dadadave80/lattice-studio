/**
 * Services (contracts §5.2): plain functions with a registration seam, so a module can call a service before
 * its implementing WP lands. K2's defaults hold what they can't deliver (log, announce, toast, banners are
 * replayed into the real implementation when it registers) or do the least that works (connection,
 * deployments, escape stack, dialogs, drag and drop).
 *
 * Implementations register with `provideServices` at module evaluation, in the module's `services.ts`
 * (see `discover.ts`), before the app renders: hooks (`useRegion`, `useOnline`, `useSaveStatus`) call
 * whichever implementation is current when they run.
 */
import type {
  CommandRef, ConsoleLine, Deployment, Layout, Project, ProblemCode, Random, Recipe, Result,
} from "@lattice-studio/core";
import { NotImplemented } from "@lattice-studio/core";
import { useSyncExternalStore, type HTMLAttributes, type RefCallback } from "react";
import type { ChainService } from "./chain";
import type { DialogEntry, DialogId, DialogPropsMap } from "./dialogs";
import { clearLog, provideKernel, randomBytes, recordedLog, resetKernel as resetKernelForServices } from "./kernel";
import { REGION_LABELS, type RegionId } from "./regions";
import { listenerSet } from "./relay";
import { doc, session, settings, type Viewport } from "./stores";

export { log, now, randomBytes } from "./kernel";

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

/** What a new project starts with besides its recipe. */
export type NewProjectOptions = {
  /** Card positions, already tidied by the caller (spec L409). Default: empty. */
  layout?: Layout;
  /** Per argument path: "link" for a share link, "file" for an opened file (LINK-01). Default: empty. */
  provenance?: Project["provenance"];
};

export type ProjectsService = {
  /** Creates a project around `recipe`, makes it the open document and saves it. */
  createProject(recipe: Recipe, name: string, options?: NewProjectOptions): Promise<Result<Project, string>>;
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
  /** Called after every write, from this tab or another; `projectId` names the project whose records changed. */
  subscribe(listener: (projectId: string) => void): () => void;
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

type Rest = Omit<Services, "log" | "now" | "randomBytes">;

// ---------------------------------------------------------------------------------------------------------
// K2's defaults

const RECORD_CAP = 200;

/** What was said, shown or announced (always recorded, capped), and what's still waiting for its service. */
type Records = {
  announce: [string, AnnounceOptions | undefined][];
  toast: ToastInput[];
  /** Banners showing now, by id. */
  banners: Map<string, BannerProps>;
};

function capped<T>(list: T[], item: T): void {
  list.push(item);
  if (list.length > RECORD_CAP) list.splice(0, list.length - RECORD_CAP);
}

function listeners<T>(): { add(fn: (v: T) => void): () => void; emit(v: T): void } {
  return listenerSet<(v: T) => void>();
}

/**
 * A stable subscription to a service's events. Listeners attach here, not to the implementation, so a
 * subscription made before the real service registers hears the real service afterwards: `reattach` moves
 * the one upstream subscription to the current implementation and, when given, re-announces the current value.
 */
type ServiceRelay<T> = { subscribe(listener: (value: T) => void): () => void; reattach(): void };

function serviceRelay<T>(
  upstream: () => (listener: (value: T) => void) => () => void,
  current?: (emit: (value: T) => void) => void,
): ServiceRelay<T> {
  let detach: (() => void) | null = null;
  const fan = (value: T) => set.emit(value);
  const sync = () => {
    if (set.size > 0 && !detach) detach = upstream()(fan);
    else if (set.size === 0 && detach) {
      detach();
      detach = null;
    }
  };
  const set = listenerSet<(value: T) => void>(sync);
  return {
    subscribe: (listener) => set.add(listener),
    reattach() {
      detach?.();
      detach = null;
      sync();
      if (set.size > 0) current?.(fan);
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

function memoryDeployments(): DeploymentsService & { clear(): void } {
  const records = new Map<string, Deployment>();
  const changed = listeners<string>();
  return {
    listDeployments: async (projectId) => [...records.values()].filter((d) => d.projectId === projectId),
    putDeployment: async (d) => {
      records.set(`${d.chainId}:${d.address.toLowerCase()}`, d);
      changed.emit(d.projectId);
    },
    subscribe: (listener) => changed.add(listener),
    clear: () => records.clear(),
  };
}

/** K2's in-memory deployment records, the default until S7a registers. */
let memory = memoryDeployments();

function hex(bytes: Uint8Array): `0x${string}` {
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function minimalProjects(): ProjectsService {
  const status: SaveStatus = { state: "not-saved", text: "Not saved", detail: "Not built yet · WP-S7a" };
  return {
    async createProject(recipe, name, options) {
      const project: Project = {
        id: hex(randomBytes(16)).slice(2),
        name,
        recipe,
        layout: options?.layout ?? {},
        deploy: { path: settings.get().defaultPath, entropy: hex(randomBytes(11)), scope: "every-chain" },
        provenance: options?.provenance ?? {},
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
      return () => {
        targets.delete(target);
      };
    },
    subscribeDrag: (listener) => drags.add(listener),
  };
}

function freshRecords(): Records {
  return { announce: [], toast: [], banners: new Map() };
}

let records = freshRecords();
/** Held until the service registers. */
let pending = freshRecords();

function defaults(): Rest {
  const escapes: EscapeHandler[] = [];
  return {
    announce: (text, options) => capped(pending.announce, [text, options]),
    toast: (input) => capped(pending.toast, input),
    showBanner: (id, props) => void pending.banners.set(id, props),
    hideBanner: (id) => void pending.banners.delete(id),
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
    deployments: memory,
    chain: () => Promise.reject(new NotImplemented("S8a", "chainService")),
    dnd: minimalDnd(),
    openProblemDoc: (code) => {
      session.set((s) => ({ panes: { ...s.panes, inspector: { ...s.panes.inspector, open: true, view: { kind: "doc", code } } } }));
    },
    connection: browserConnection(),
  };
}

let impl: Rest = defaults();

// Stable subscriptions over the current implementation (see `serviceRelay`).
const saveStatusRelay = serviceRelay<SaveStatus>(
  () => (fan) => impl.projects.subscribeSaveStatus(fan),
  (emit) => emit(impl.projects.saveStatus()),
);
const onlineRelay = serviceRelay<boolean>(
  () => (fan) => impl.connection.subscribe(fan),
  (emit) => emit(impl.connection.isOnline()),
);
const dragRelay = serviceRelay<CatalogDrag | null>(() => (fan) => impl.dnd.subscribeDrag(fan), (emit) => emit(null));
const deploymentsRelay = serviceRelay<string>(
  () => (fan) => impl.deployments.subscribe(fan),
  // New records service: every project someone is watching may read differently now.
  (emit) => {
    for (const projectId of deploymentCache.keys()) emit(projectId);
  },
);

/** Drop targets registered so far, each with its registration on the current dnd service. */
const dropTargets = new Map<DropTarget, () => void>();

function reattach(previous: Rest): void {
  if (previous.dnd !== impl.dnd) {
    for (const [target, dispose] of dropTargets) {
      dispose();
      dropTargets.set(target, impl.dnd.registerDropTarget(target));
    }
  }
  if (previous.projects !== impl.projects) saveStatusRelay.reattach();
  if (previous.connection !== impl.connection) onlineRelay.reattach();
  if (previous.dnd !== impl.dnd) dragRelay.reattach();
  if (previous.deployments !== impl.deployments) deploymentsRelay.reattach();
}

/**
 * Replaces services with real implementations. Held announcements, toasts and shown banners are replayed
 * into the new implementation (log lines too, through the kernel). Returns a disposer that puts back only
 * what this call provided and nobody has replaced since.
 */
export function provideServices(provided: Partial<Services>): () => void {
  const { log: providedLog, now: providedNow, randomBytes: providedRandom, ...rest } = provided;
  const kernel: Parameters<typeof provideKernel>[0] = {};
  if (providedLog) kernel.log = providedLog;
  if (providedNow) kernel.now = providedNow;
  if (providedRandom) kernel.randomBytes = providedRandom;
  const disposeKernel = provideKernel(kernel);

  const previous = impl;
  impl = { ...impl, ...rest };
  reattach(previous);
  if (rest.announce) for (const [text, options] of pending.announce.splice(0)) rest.announce(text, options);
  if (rest.toast) for (const input of pending.toast.splice(0)) rest.toast(input);
  if (rest.showBanner) {
    for (const [id, props] of pending.banners) rest.showBanner(id, props);
    pending.banners.clear();
  }
  return () => {
    disposeKernel();
    const before = impl;
    const restored: Record<string, unknown> = { ...impl };
    for (const key of Object.keys(rest) as (keyof Rest)[]) {
      if (impl[key] === rest[key]) restored[key] = previous[key];
    }
    impl = restored as Rest;
    reattach(before);
  };
}

/** @internal K2's defaults, empty records (contract tests). Returns a disposer that restores the previous state. */
export function resetServices(): () => void {
  const saved = { impl, records, pending, memory };
  const restoreKernel = resetKernelForServices();
  memory = memoryDeployments();
  impl = defaults();
  reattach(saved.impl);
  records = freshRecords();
  pending = freshRecords();
  return () => {
    restoreKernel();
    const before = impl;
    impl = saved.impl;
    memory = saved.memory;
    reattach(before);
    records = saved.records;
    pending = saved.pending;
  };
}

/** @internal Empties K2's in-memory deployment records (the harness, between tests). */
export function clearMemoryDeployments(): void {
  memory.clear();
}

/**
 * @internal Everything logged, announced, toasted and shown so far, whether or not a real service took it
 * (the harness's `bufferedServices()`).
 */
export function bufferedServices(): {
  log: readonly ConsoleLine[];
  announce: readonly [string, AnnounceOptions | undefined][];
  toast: readonly ToastInput[];
  banners: ReadonlyMap<string, BannerProps>;
} {
  return { log: recordedLog(), announce: records.announce, toast: records.toast, banners: records.banners };
}

/** @internal Empties the records and anything held; keeps every registered implementation (between tests). */
export function clearServiceBuffers(): void {
  clearLog();
  records = freshRecords();
  pending = freshRecords();
}

// ---------------------------------------------------------------------------------------------------------
// The calls

export function announce(text: string, options?: AnnounceOptions): void {
  capped(records.announce, [text, options]);
  impl.announce(text, options);
}

export function toast(input: ToastInput): void {
  capped(records.toast, input);
  impl.toast(input);
}

export function showBanner(id: string, props: BannerProps): void {
  records.banners.set(id, props);
  impl.showBanner(id, props);
}

export function hideBanner(id: string): void {
  records.banners.delete(id);
  impl.hideBanner(id);
}

let dialogKey = 0;

/** Pushes the dialog onto the session's stack. Its owner renders it. */
export function openDialog<I extends DialogId>(
  id: I,
  ...props: Record<string, never> extends DialogPropsMap[I] ? [props?: DialogPropsMap[I]] : [props: DialogPropsMap[I]]
): void {
  dialogKey += 1;
  const key = dialogKey;
  const entry = { id, props: props[0] ?? {}, key } as unknown as DialogEntry;
  session.set((s) => ({ dialogs: [...s.dialogs, entry] }));
}

/** Closes the topmost dialog with this id. */
export function closeDialog(id: DialogId): void {
  session.set((s) => {
    const at = s.dialogs.map((d) => d.id).lastIndexOf(id);
    return at < 0 ? {} : { dialogs: s.dialogs.filter((_, i) => i !== at) };
  });
}

/** Props for a region container. A hook: call it in render. */
export function useRegion(id: RegionId): RegionProps {
  return impl.useRegion(id);
}

/** Pushes an Esc handler onto the stack; returns a disposer. */
export function pushEscape(handler: EscapeHandler): () => void {
  return impl.pushEscape(handler);
}

export function createProject(recipe: Recipe, name: string, options?: NewProjectOptions): Promise<Result<Project, string>> {
  return impl.projects.createProject(recipe, name, options);
}

export function openProject(id: string): Promise<Result<Project, string>> {
  return impl.projects.openProject(id);
}

export function saveStatus(): SaveStatus {
  return impl.projects.saveStatus();
}

/** Subscribes to save-status changes; follows the projects service when S7a registers. */
export function subscribeSaveStatus(listener: (status: SaveStatus) => void): () => void {
  return saveStatusRelay.subscribe(listener);
}

/** The save status, re-rendering when it changes. */
export function useSaveStatus(): SaveStatus {
  return useSyncExternalStore(saveStatusRelay.subscribe, () => impl.projects.saveStatus());
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
 * Subscribes to deployment-record writes; the listener gets the project id whose records changed. Follows
 * the deployments service when S7a registers.
 */
export function subscribeDeployments(listener: (projectId: string) => void): () => void {
  return deploymentsRelay.subscribe(listener);
}

type DeploymentsSnapshot = { status: "loading" } | { status: "ready"; deployments: Deployment[] };

const deploymentCache = new Map<string, DeploymentsSnapshot>();
const deploymentListeners = listeners<string>();
const LOADING: DeploymentsSnapshot = { status: "loading" };

function refreshDeployments(projectId: string): void {
  impl.deployments.listDeployments(projectId).then(
    (deployments) => {
      deploymentCache.set(projectId, { status: "ready", deployments });
      deploymentListeners.emit(projectId);
    },
    () => {
      deploymentCache.set(projectId, { status: "ready", deployments: [] });
      deploymentListeners.emit(projectId);
    },
  );
}

/**
 * A project's deployment records, re-rendering after every write. Each mount reads them again (records
 * written while nothing watched still show); until the first read returns it's `loading`, or the last list read.
 */
export function useDeployments(projectId: string): DeploymentsSnapshot {
  return useSyncExternalStore(
    (onChange) => {
      const stopWrites = deploymentsRelay.subscribe((changed) => {
        if (changed === projectId) refreshDeployments(projectId);
      });
      const stopCache = deploymentListeners.add((changed) => {
        if (changed === projectId) onChange();
      });
      refreshDeployments(projectId);
      return () => {
        stopWrites();
        stopCache();
      };
    },
    () => deploymentCache.get(projectId) ?? LOADING,
  );
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

/** Registers a drop target; it moves to the real dnd service when that registers. Returns a disposer. */
export function registerDropTarget(target: DropTarget): () => void {
  dropTargets.get(target)?.();
  dropTargets.set(target, impl.dnd.registerDropTarget(target));
  return () => {
    dropTargets.get(target)?.();
    dropTargets.delete(target);
  };
}

/** Subscribes to the catalog drag in progress; follows the dnd service when it registers. */
export function subscribeCatalogDrag(listener: (drag: CatalogDrag | null) => void): () => void {
  return dragRelay.subscribe(listener);
}

/** Shows the problem's doc page in the inspector (K2's default routes there; S12 replaces it). */
export function openProblemDoc(code: ProblemCode): void {
  impl.openProblemDoc(code);
}

export function isOnline(): boolean {
  return impl.connection.isOnline();
}

/** Whether the browser is online, re-rendering when it changes. */
/** Subscribes to online and offline changes; follows the connection service when S11a registers. */
export function subscribeOnline(listener: (online: boolean) => void): () => void {
  return onlineRelay.subscribe(listener);
}

export function useOnline(): boolean {
  return useSyncExternalStore(onlineRelay.subscribe, () => impl.connection.isOnline());
}

/** @internal Forgets cached deployment lists (between tests). */
export function clearDeploymentCache(): void {
  deploymentCache.clear();
}
