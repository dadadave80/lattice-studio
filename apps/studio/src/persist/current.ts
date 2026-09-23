/**
 * The app's persistence instance, loaded on first use: this file stays in the entry chunk (through
 * `services.ts`), so it imports no IndexedDB code, only types and a lazy `import()`. The projects and
 * deployments services registered with the contracts forward here, and so does the public API in `index.ts`.
 * Subscriptions made before the instance loads (or before a test provides one) follow it.
 */
import type { Project, Result } from "@lattice-studio/core";
import { useSyncExternalStore } from "react";
import { log, type DeploymentsService, type ProjectsService, type SaveStatus } from "@/contracts";
import type { EditLockState } from "./lock";
import type { Persistence } from "./persistence";

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
  subscribe(listener) {
    deploymentListeners.add(listener);
    return () => void deploymentListeners.delete(listener);
  },
};

/**
 * Whether the page was opened on a route that picks its own project: a share link (`#s=`) or `#open=`. Other
 * hash routes (`#/settings`, and every route of the IPFS build, `env.hashRouting`) still land in the last one.
 */
function routeOpensProject(hash: string): boolean {
  return hash.startsWith("#s=") || hash.startsWith("#open=");
}

/**
 * Whether the document is still the one the boot started on. A recorded prediction doesn't count: a wallet
 * that reconnects on load records one (`state/prediction.ts`) without the visitor doing anything.
 */
function untouched(booted: Project, now: Project): boolean {
  if (now === booted) return true;
  const keys = new Set([...Object.keys(booted), ...Object.keys(now)] as (keyof Project)[]);
  for (const key of keys) if (key !== "predicted" && booted[key] !== now[key]) return false;
  return true;
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
      if (opened && !opened.ok) log({ tag: "Error", text: `Couldn't open your last project. ${opened.error}` });
      return opened;
    })
    .catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      log({ tag: "Error", text: `Couldn't open this browser's storage. ${reason}` });
      return null;
    });
}
