/**
 * The app's persistence instance, loaded on first use: this file stays in the entry chunk (through
 * `services.ts`), so it imports no IndexedDB code, only types, `untouched.ts` (whose one import,
 * `state/document-store`, is in the entry chunk already) and a lazy `import()`. The projects and
 * deployments services registered with the contracts forward here, and so does the public API in `index.ts`.
 * Subscriptions made before the instance loads (or before a test provides one) follow it.
 */
import type { Project, Result } from "@lattice-studio/core";
import { useSyncExternalStore } from "react";
import { announce, doc, log, type DeploymentsService, type ProjectsService, type SaveStatus } from "@/contracts";
import type { EditLockState } from "./lock";
import type { Persistence } from "./persistence";
import { untouched } from "./untouched";

const SAVED: SaveStatus = { state: "saved", text: "Saved" };
const NO_LOCK: EditLockState = { state: "none" };

let active: Persistence | null = null;
let loading: Promise<Persistence> | null = null;
let detach: (() => void) | null = null;

const statusListeners = new Set<(status: SaveStatus) => void>();
const lockListeners = new Set<(state: EditLockState) => void>();
const deploymentListeners = new Set<(projectId: string) => void>();
const projectListeners = new Set<() => void>();

function each<T>(set: Set<(value: T) => void>, value: T): void {
  for (const listener of Array.from(set)) listener(value);
}

function attach(next: Persistence | null): void {
  detach?.();
  detach = null;
  active = next;
  if (next) {
    const stops = [
      next.projects.subscribeSaveStatus((status) => each(statusListeners, status)),
      next.subscribeEditLock((state) => each(lockListeners, state)),
      next.deployments.subscribe((projectId) => each(deploymentListeners, projectId)),
      next.subscribeProjects(() => each(projectListeners, undefined)),
    ];
    detach = () => {
      for (const stop of stops) stop();
    };
  }
  each(statusListeners, saveStatusNow());
  each(lockListeners, editLockState());
  each(projectListeners, undefined);
}

/** The persistence instance, created (and its code loaded) on first call. */
export function persistence(): Promise<Persistence> {
  if (active) return Promise.resolve(active);
  loading ??= import("./persistence").then(({ createPersistence }) => {
    const instance = active ?? createPersistence();
    if (instance !== active) attach(instance);
    return instance;
  });
  return loading;
}

/**
 * Uses `instance` as the app's persistence (tests; see `testing.ts`). Returns a disposer that puts the previous
 * one back.
 */
export function providePersistence(instance: Persistence): () => void {
  const previous = active;
  const previousLoading = loading;
  attach(instance);
  loading = Promise.resolve(instance);
  return () => {
    if (active !== instance) return;
    attach(previous);
    loading = previousLoading;
  };
}

function saveStatusNow(): SaveStatus {
  return active?.projects.saveStatus() ?? SAVED;
}

/** The edit lock of the open project: held here, elsewhere (read-only) or handed over. Non-reactive. */
export function editLockState(): EditLockState {
  return active?.editLock() ?? NO_LOCK;
}

/** Subscribes to the edit lock's state (S13's banners and read-only reason). */
export function subscribeEditLock(listener: (state: EditLockState) => void): () => void {
  lockListeners.add(listener);
  return () => void lockListeners.delete(listener);
}

/** The edit lock's state, re-rendering when it changes. */
export function useEditLock(): EditLockState {
  return useSyncExternalStore(subscribeEditLock, editLockState);
}

/** Subscribes to changes of the stored projects list, from this tab or another. */
export function subscribeProjects(listener: () => void): () => void {
  projectListeners.add(listener);
  return () => void projectListeners.delete(listener);
}

/**
 * A project that couldn't be opened (spec L696): the sheet's error state, "This project couldn't be opened:
 * {reason}" with Open another project and Copy details (`sheet/chrome/OpenError.tsx`). `details` is what Copy
 * details puts on the clipboard, the message first.
 */
export type OpenFailure = { text: string; reason: string; details: string };

let failure: OpenFailure | null = null;
/** The document the failure was shown over: any other document (a load, an edit) ends the error state. */
let failedOver: Project | null = null;
let stopWatchingDoc: (() => void) | null = null;
const failureListeners = new Set<() => void>();

/** "This project couldn't be opened: {reason}" (spec L696). */
export function openFailureText(reason: string): string {
  return `This project couldn't be opened: ${reason}`;
}

/**
 * Shows the sheet's error state for a project that couldn't be opened, and says so once: an Error line in the
 * console (the record) and a polite announcement. Callers (the boot below, importing a file) don't log it
 * themselves. `details` are extra lines for Copy details (which file, every parse issue). The state lasts until
 * the document changes, Esc, or the next failure replaces it.
 */
export function showOpenFailure(reason: string, details: readonly string[] = []): void {
  const text = openFailureText(reason);
  failure = { text, reason, details: [text, ...details].join("\n") };
  failedOver = doc.get();
  stopWatchingDoc ??= doc.subscribe((state) => {
    if (state.project !== failedOver) clearOpenFailure();
  });
  log({ tag: "Error", text });
  announce(text);
  for (const listener of Array.from(failureListeners)) listener();
}

/** Ends the error state (Esc, or the document changed). Does nothing when none is showing. */
export function clearOpenFailure(): void {
  stopWatchingDoc?.();
  stopWatchingDoc = null;
  failedOver = null;
  if (failure === null) return;
  failure = null;
  for (const listener of Array.from(failureListeners)) listener();
}

/** The open failure showing on the sheet, or null. Non-reactive. */
export function openFailure(): OpenFailure | null {
  return failure;
}

export function subscribeOpenFailure(listener: () => void): () => void {
  failureListeners.add(listener);
  return () => void failureListeners.delete(listener);
}

/** The open failure showing on the sheet, re-rendering when it changes. */
export function useOpenFailure(): OpenFailure | null {
  return useSyncExternalStore(subscribeOpenFailure, openFailure);
}

/** The projects service registered with the contracts (§5.2). */
export const projectsService: ProjectsService = {
  createProject: async (recipe, name, options) => (await persistence()).projects.createProject(recipe, name, options),
  openProject: async (id) => (await persistence()).projects.openProject(id),
  saveStatus: saveStatusNow,
  subscribeSaveStatus(listener) {
    statusListeners.add(listener);
    return () => void statusListeners.delete(listener);
  },
  loadViewport: async (id) => (await persistence()).projects.loadViewport(id),
  saveViewport(id, viewport) {
    if (active) active.projects.saveViewport(id, viewport);
    else void persistence().then((p) => p.projects.saveViewport(id, viewport), () => {});
  },
};

/** The deployments service registered with the contracts (§5.2). Records never wait for the edit lock. */
export const deploymentsService: DeploymentsService = {
  listDeployments: async (projectId) => (await persistence()).deployments.listDeployments(projectId),
  putDeployment: async (deployment) => (await persistence()).deployments.putDeployment(deployment),
  deleteDeployment: async (chainId, address) => (await persistence()).deployments.deleteDeployment(chainId, address),
  subscribe(listener) {
    deploymentListeners.add(listener);
    return () => void deploymentListeners.delete(listener);
  },
};

/** Copy details' context line for the boot's failure. */
export const LAST_PROJECT_DETAIL = "While reopening your last project on load.";

/**
 * Whether the page was opened on a route that picks its own project: a share link (`#s=`) or `#open=`. Other
 * hash routes (`#/settings`, and every route of the IPFS build, `env.hashRouting`) still land in the last one.
 */
function routeOpensProject(hash: string): boolean {
  return hash.startsWith("#s=") || hash.startsWith("#open=");
}

/**
 * Starts persistence in the app: autosave follows the document, and a returning visitor lands in their last
 * project (spec L401) unless the route opens one, or the document changed (an edit, another project opened)
 * while storage was read.
 */
export function bootPersistence(): Promise<Result<Project, string> | null> {
  return persistence()
    .then(async (p) => {
      p.start();
      // The boot document as `start()` leaves it (it gives an unsaved document its own id).
      const booted = p.document();
      if (typeof location !== "undefined" && routeOpensProject(location.hash)) return null;
      const opened = await p.openLastProject(() => untouched(booted, p.document()));
      if (opened && !opened.ok) showOpenFailure(opened.error, [LAST_PROJECT_DETAIL]);
      return opened;
    })
    .catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      log({ tag: "Error", text: `Couldn't open this browser's storage. ${reason}` });
      return null;
    });
}
