/**
 * Persistence (spec L27 decision 15, Flow 10, L845): IndexedDB autosave after 750 ms of quiet, flushed at once
 * when the tab hides, closes or hands over its edit lock; deployment records in their own store, written
 * without the lock; Recently deleted for 30 days; the edit lock and BroadcastChannel between tabs; viewports
 * per project in `meta`; persistent storage after the first explicit save.
 *
 * `createPersistence` makes one instance per database name: the app makes one (`services.ts`), tests make one
 * per test and two to play two tabs. Nothing opens until first used.
 */
import {
  exportProjectFile, type Deployment, type ExportFile, type Project, type ProjectFile, type Recipe, type Result,
} from "@lattice-studio/core";
import {
  commandRef, doc as studioDoc, hideBanner, log, now as kernelNow, randomBytes, settings, showBanner,
  type DeploymentsService, type DocumentState, type NewProjectOptions, type ProjectsService, type SaveStatus,
  type Viewport,
} from "@/contracts";
import { openChannel, type ChannelMessage } from "./channel";
import { DB_NAME, isQuotaError, META, openStudioDb, type StudioDb } from "./db";
import { createEditLock, type EditLockState } from "./lock";
import * as records from "./records";
import type { ClearDataCounts, ProjectSummary, RecordCounts, TrashSummary } from "./records";

/** The document store as persistence uses it (`doc` from the contracts; a stand-in for a second test tab). */
export type DocPort = {
  get(): Project;
  subscribe(listener: (state: DocumentState, previous: DocumentState) => void): () => void;
  load(project: Project, reason?: string): void;
};

/** `navigator.storage` as far as persistence uses it. */
export type StoragePort = {
  persist?(): Promise<boolean>;
  persisted?(): Promise<boolean>;
  estimate?(): Promise<StorageEstimate>;
};

export type PersistenceOptions = {
  /** Default `lattice-studio`. Lock and channel names derive from it, so test instances never meet the app's. */
  dbName?: string;
  /** Default: the contracts' document store. */
  doc?: DocPort;
  /** Default: the kernel's clock. */
  now?: () => number;
  /** Default `navigator.locks`; null: every tab edits. */
  locks?: LockManager | null;
  /** Default `navigator.storage`. */
  storage?: StoragePort | null;
  /** Default `navigator.userAgent` (the Safari tip). */
  userAgent?: string;
  /** Autosave's quiet period, ms (spec L498). */
  quietMs?: number;
  /** How long Take over editing waits for the other tab before stealing the lock, ms. */
  stealAfter?: number;
  /** Where `visibilitychange` and `pagehide` are heard. Default the page; null to not listen. */
  page?: { document: Document; window: Window } | null;
};

/** What happened to an imported project file's records. */
export type ImportResult = { project: Project; added: number; skipped: number };

/** What an explicit save learned: whether it was the first, whether storage is now persistent, the Safari tip. */
export type ExplicitSave = {
  first: boolean;
  /** Null where the browser can't say. */
  persisted: boolean | null;
  /** Show the one-time Safari tip now (spec L500). It's marked shown. */
  safariTip: boolean;
};

export type StorageInfo = { usage: number | null; quota: number | null; persisted: boolean | null };

export type Persistence = {
  readonly dbName: string;
  projects: ProjectsService;
  deployments: DeploymentsService;
  /** Follows the document: autosave, the page's hide events and the other tabs. Idempotent. */
  start(): void;
  /** Writes the pending save now (hide, close, lock handover, Save and reload). */
  flush(): Promise<void>;
  /**
   * Opens the project last opened in this browser (else the last saved); null when there's none, or when
   * `proceed` says no once it's known which (the document changed meanwhile).
   */
  openLastProject(proceed?: () => boolean): Promise<Result<Project, string> | null>;
  editLock(): EditLockState;
  subscribeEditLock(listener: (state: EditLockState) => void): () => void;
  /** Take over editing / Take back editing: the other tab flushes and lets go, then this tab loads its save. */
  takeOverEditing(): Promise<Result<Project, string>>;
  listProjects(): Promise<ProjectSummary[]>;
  /** Renames a stored project that isn't open here (the open one renames through `project.rename`). */
  renameProject(id: string, name: string): Promise<Result<ProjectSummary, string>>;
  /** Copies a project under a new id, with fresh salt entropy and no deployment records. */
  duplicateProject(id: string): Promise<Result<Project, string>>;
  /** Moves the project and its records to Recently deleted (no confirmation, spec L502). */
  deleteProject(id: string): Promise<Result<RecordCounts, string>>;
  restoreProject(id: string): Promise<Result<Project, string>>;
  deleteForGood(id: string): Promise<Result<RecordCounts, string>>;
  listTrash(): Promise<TrashSummary[]>;
  /** What deleting a Recently deleted project for good would lose; null when it isn't there. */
  trashCounts(id: string): Promise<RecordCounts | null>;
  /** Stores an imported project file as a new project and opens it (records keep `fromFile`). */
  importProject(project: Project, deployments: readonly Deployment[]): Promise<Result<ImportResult, string>>;
  /** Every project, Recently deleted included, as `.lattice.json` files with their records. */
  exportAll(): Promise<ExportFile[]>;
  clearDataCounts(): Promise<ClearDataCounts>;
  clearData(): Promise<void>;
  /** Subscribes to changes of the projects list (delete, restore, import, clear, rename, duplicate), in any tab. */
  subscribeProjects(listener: () => void): () => void;
  /** After ⌘S or Save a copy: asks for persistent storage the first time (spec L500). */
  markExplicitSave(): Promise<ExplicitSave>;
  storageInfo(): Promise<StorageInfo>;
  /** Stops listening and closes the database. */
  close(): Promise<void>;
};

const QUIET_MS = 750;

const SAVED: SaveStatus = { state: "saved", text: "Saved" };
const SAVING: SaveStatus = { state: "saving", text: "Saving…" };
const FULL_TEXT = "Not saved: browser storage is full";
const UPDATED_TEXT = "Studio was updated in another tab. Reload to continue.";
const STORAGE_FULL_BANNER = "persist.storage-full";
const UPDATED_BANNER = "persist.updated";

function hex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isViewport(value: unknown): value is Viewport {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v["x"] === "number" && typeof v["y"] === "number" && typeof v["zoom"] === "number";
}

/** Safari, which can clear site data after 7 days without a visit (spec L500). */
export function isSafari(userAgent: string): boolean {
  return /safari/i.test(userAgent) && !/chrome|chromium|crios|fxios|edg|android/i.test(userAgent);
}

function uniqueNames(files: ExportFile[]): ExportFile[] {
  const seen = new Map<string, number>();
  return files.map((file) => {
    const count = (seen.get(file.filename) ?? 0) + 1;
    seen.set(file.filename, count);
    if (count === 1) return file;
    return { ...file, filename: file.filename.replace(/\.lattice\.json$/, `-${count}.lattice.json`) };
  });
}

export function createPersistence(options: PersistenceOptions = {}): Persistence {
  const dbName = options.dbName ?? DB_NAME;
  const doc = options.doc ?? studioDoc;
  const now = options.now ?? kernelNow;
  const quietMs = options.quietMs ?? QUIET_MS;
  const nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator;
  const storage = options.storage === undefined ? (nav?.storage ?? null) : options.storage;
  const userAgent = options.userAgent ?? nav?.userAgent ?? "";
  const page = options.page === undefined
    ? typeof window === "undefined" ? null : { document, window }
    : options.page;
  const peerId = hex(randomBytes(8)).slice(2);
  const channel = openChannel(`${dbName}:tabs`);

  // ── Database ────────────────────────────────────────────────────────────────────────────────────────

  let opened: Promise<StudioDb> | null = null;
  /** A newer Studio upgraded the database: this connection closed. */
  let updated = false;
  let closed = false;

  const db = (): Promise<StudioDb> => {
    if (updated) return Promise.reject(new Error(UPDATED_TEXT));
    if (closed) return Promise.reject(new Error("Storage is closed."));
    opened ??= openStudioDb(dbName, { onVersionChange: versionChanged }).then(async (handle) => {
      await records.purgeTrash(handle, now()).catch(() => []);
      return handle;
    });
    return opened;
  };

  function versionChanged(): void {
    const closing = opened;
    void flush()
      .catch(() => {})
      .then(() => {
        updated = true;
        refreshStatus();
        return closing;
      })
      .then((handle) => handle?.close())
      .catch(() => {});
    showBanner(UPDATED_BANNER, { text: UPDATED_TEXT, tone: "warning", actions: [commandRef("app.reload")] });
  }

  // ── Save status ─────────────────────────────────────────────────────────────────────────────────────

  let status: SaveStatus = SAVED;
  const statusListeners = new Set<(status: SaveStatus) => void>();
  /** The last write's failure: the quota, or another reason. */
  let failure: { quota: boolean; reason: string } | null = null;

  function computeStatus(): SaveStatus {
    const lockState = lock.state();
    if (lockState.state === "elsewhere") {
      return { state: "read-only", text: "Read-only", detail: "Another tab is editing this project" };
    }
    if (lockState.state === "handed-over") {
      return { state: "read-only", text: "Read-only", detail: "Editing moved to another tab" };
    }
    if (updated) return { state: "not-saved", text: "Not saved", detail: UPDATED_TEXT };
    if (timer !== null || writing !== null) return SAVING;
    if (failure?.quota) return { state: "not-saved", text: FULL_TEXT };
    if (failure) return { state: "not-saved", text: "Not saved", detail: failure.reason };
    return SAVED;
  }

  function refreshStatus(): void {
    const next = computeStatus();
    if (next.state === status.state && next.text === status.text && next.detail === status.detail) return;
    status = next;
    for (const listener of Array.from(statusListeners)) listener(next);
  }

  // ── The open project and autosave ───────────────────────────────────────────────────────────────────

  /** The project this instance saves. */
  let openId: string | null = null;
  /** The value last written or read for `openId`; the document differs from it when there's something to save. */
  let persisted: Project | null = null;
  /** The open project was deleted or the data cleared here: don't write it back. */
  let detached = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> | null = null;
  /** Set while this instance loads the document itself, so the load isn't broadcast as an edit. */
  let quiet = 0;

  const loadQuietly = (project: Project, reason?: string) => {
    quiet += 1;
    try {
      doc.load(project, reason);
    } finally {
      quiet -= 1;
    }
  };

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const holds = (id: string) => {
    const state = lock.state();
    return state.state === "held" && state.projectId === id;
  };

  const dirty = () => {
    const project = doc.get();
    return openId !== null && !detached && project.id === openId && project !== persisted;
  };

  function schedule(): void {
    clearTimer();
    if (!dirty()) {
      refreshStatus();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void flush().catch(() => {});
    }, quietMs);
    refreshStatus();
  }

  async function write(project: Project): Promise<void> {
    try {
      await records.writeProject(await db(), project, now());
      if (doc.get().id === project.id) persisted = project;
      if (failure?.quota) hideBanner(STORAGE_FULL_BANNER);
      failure = null;
    } catch (error) {
      const quota = isQuotaError(error);
      const firstTime = !failure || failure.quota !== quota;
      failure = { quota, reason: message(error) };
      if (quota && firstTime) {
        showBanner(STORAGE_FULL_BANNER, { text: FULL_TEXT, tone: "error", actions: [commandRef("project.saveCopy")] });
        log({ tag: "Error", text: `${FULL_TEXT}.` });
      } else if (firstTime && !updated) {
        log({ tag: "Error", text: `Not saved: ${message(error)}` });
      }
    }
  }

  async function flush(): Promise<void> {
    clearTimer();
    await flushViewports().catch(() => {});
    while (writing) await writing;
    const project = doc.get();
    if (!dirty() || !holds(project.id)) {
      refreshStatus();
      return;
    }
    writing = write(project).finally(() => {
      writing = null;
    });
    refreshStatus();
    await writing;
    refreshStatus();
  }

  /** Claims the lock for the open project; once held, anything unsaved is scheduled. */
  async function claim(id: string): Promise<boolean> {
    const held = await lock.claim(id).catch(() => false);
    if (openId === id) schedule();
    return held;
  }

  /** The document switched to a project this instance didn't open (a migration, a link, a test seed). */
  function adopt(project: Project): void {
    clearTimer();
    openId = project.id;
    persisted = null;
    detached = false;
    failure = null;
    void claim(project.id);
    refreshStatus();
  }

  function onDocChange(state: DocumentState, previous: DocumentState): void {
    if (state.project === previous.project && state.lastChange?.revision === previous.lastChange?.revision) return;
    const project = state.project;
    if (project.id !== openId) {
      adopt(project);
      return;
    }
    if (quiet > 0 || detached) return;
    if (holds(project.id) && state.lastChange?.kind !== "drag") {
      channel.post({ kind: "change", from: peerId, id: project.id, project });
    }
    schedule();
  }

  // ── Lock ────────────────────────────────────────────────────────────────────────────────────────────

  const lockListeners = new Set<(state: EditLockState) => void>();
  const lock = createEditLock({
    prefix: dbName,
    locks: options.locks === undefined ? (nav?.locks ?? null) : options.locks,
    channel,
    peerId,
    ...(options.stealAfter === undefined ? {} : { stealAfter: options.stealAfter }),
    beforeHandover: () => flush(),
    onChange(state) {
      if (state.state !== "held") clearTimer();
      refreshStatus();
      for (const listener of Array.from(lockListeners)) listener(state);
    },
  });

  // ── Deployment records (outside the lock) ───────────────────────────────────────────────────────────

  const deploymentListeners = new Set<(projectId: string) => void>();
  const emitDeployments = (projectId: string) => {
    for (const listener of Array.from(deploymentListeners)) listener(projectId);
  };

  const projectListeners = new Set<() => void>();
  const emitProjects = (remote = false) => {
    if (!remote) channel.post({ kind: "projects", from: peerId });
    for (const listener of Array.from(projectListeners)) listener();
  };

  const deployments: DeploymentsService = {
    async listDeployments(projectId) {
      return records.listDeployments(await db(), projectId);
    },
    async putDeployment(deployment) {
      await records.putDeployment(await db(), deployment);
      emitDeployments(deployment.projectId);
      channel.post({ kind: "deployments", from: peerId, projectId: deployment.projectId });
    },
    subscribe(listener) {
      deploymentListeners.add(listener);
      return () => void deploymentListeners.delete(listener);
    },
  };

  // ── Viewports (meta, outside the document) ──────────────────────────────────────────────────────────

  const pendingViewports = new Map<string, Viewport>();
  let viewportTimer: ReturnType<typeof setTimeout> | null = null;

  async function flushViewports(): Promise<void> {
    if (viewportTimer !== null) clearTimeout(viewportTimer);
    viewportTimer = null;
    if (pendingViewports.size === 0) return;
    const entries = Array.from(pendingViewports);
    pendingViewports.clear();
    const handle = await db();
    const tx = handle.transaction("meta", "readwrite");
    await Promise.all([...entries.map(([id, viewport]) => tx.store.put(viewport, META.viewport(id))), tx.done]);
  }

  // ── Page events and the channel ─────────────────────────────────────────────────────────────────────

  const stops: (() => void)[] = [];
  let started = false;

  const onHide = () => {
    if (page?.document.visibilityState === "hidden") void flush().catch(() => {});
  };
  const onPageHide = () => void flush().catch(() => {});

  function onMessage(msg: ChannelMessage): void {
    if (msg.from === peerId) return;
    if (msg.kind === "deployments") emitDeployments(msg.projectId);
    else if (msg.kind === "projects") emitProjects(true);
    else if (msg.kind === "change" && started && msg.id === openId && !holds(msg.id)) {
      persisted = msg.project;
      loadQuietly(msg.project);
    }
  }
  stops.push(channel.subscribe(onMessage));

  // ── Projects ────────────────────────────────────────────────────────────────────────────────────────

  function newProject(recipe: Recipe, name: string, options?: NewProjectOptions): Project {
    return {
      id: hex(randomBytes(16)).slice(2),
      name,
      recipe,
      layout: options?.layout ?? {},
      deploy: { path: settings.get().defaultPath, entropy: hex(randomBytes(11)), scope: "every-chain" },
      provenance: options?.provenance ?? {},
      predicted: [],
    };
  }

  /** Makes `project` the open document, claims its lock, and writes it when `save` (a new project). */
  async function open(project: Project, save: boolean): Promise<void> {
    clearTimer();
    openId = project.id;
    persisted = save ? null : project;
    detached = false;
    failure = null;
    loadQuietly(project);
    const held = await claim(project.id);
    if (save && held) await flush();
    else if (!save) {
      const handle = await db();
      await handle.put("meta", project.id, META.lastProject);
    }
  }

  const projects: ProjectsService = {
    async createProject(recipe, name, opts) {
      try {
        await flush();
        const project = newProject(recipe, name, opts);
        await open(project, true);
        emitProjects();
        return { ok: true, value: project };
      } catch (error) {
        return { ok: false, error: message(error) };
      }
    },
    async openProject(id) {
      try {
        const current = doc.get();
        if (openId === id && current.id === id && !detached) return { ok: true, value: current };
        await flush();
        const read = await records.readProject(await db(), id);
        if (!read.ok) return read;
        await open(read.value.project, false);
        return { ok: true, value: read.value.project };
      } catch (error) {
        return { ok: false, error: message(error) };
      }
    },
    saveStatus: () => status,
    subscribeSaveStatus(listener) {
      statusListeners.add(listener);
      return () => void statusListeners.delete(listener);
    },
    async loadViewport(id) {
      const pending = pendingViewports.get(id);
      if (pending) return pending;
      try {
        const stored = await (await db()).get("meta", META.viewport(id));
        return isViewport(stored) ? stored : null;
      } catch {
        return null;
      }
    },
    saveViewport(id, viewport) {
      pendingViewports.set(id, { x: viewport.x, y: viewport.y, zoom: viewport.zoom });
      if (viewportTimer !== null) clearTimeout(viewportTimer);
      viewportTimer = setTimeout(() => void flushViewports().catch(() => {}), quietMs);
    },
  };

  const persistence: Persistence = {
    dbName,
    projects,
    deployments,
    start() {
      if (started) return;
      started = true;
      const current = doc.get();
      openId = current.id;
      persisted = current;
      void claim(current.id);
      stops.push(doc.subscribe(onDocChange));
      if (page) {
        page.document.addEventListener("visibilitychange", onHide);
        page.window.addEventListener("pagehide", onPageHide);
        stops.push(() => {
          page.document.removeEventListener("visibilitychange", onHide);
          page.window.removeEventListener("pagehide", onPageHide);
        });
      }
    },
    flush,
    async openLastProject(proceed) {
      try {
        const handle = await db();
        const last = await handle.get("meta", META.lastProject);
        const id = typeof last === "string" && (await handle.getKey("projects", last)) !== undefined
          ? last
          : (await records.listProjects(handle))[0]?.id;
        if (id === undefined || (proceed && !proceed())) return null;
        return await projects.openProject(id);
      } catch (error) {
        return { ok: false, error: message(error) };
      }
    },
    editLock: () => lock.state(),
    subscribeEditLock(listener) {
      lockListeners.add(listener);
      return () => void lockListeners.delete(listener);
    },
    async takeOverEditing() {
      const id = openId;
      if (id === null) return { ok: false, error: "No project is open." };
      try {
        const held = await lock.takeOver(id);
        if (!held) return { ok: false, error: "Couldn't take over editing. Another tab kept it." };
        const read = await records.readProject(await db(), id);
        if (!read.ok) return read;
        if (openId === id) {
          persisted = read.value.project;
          loadQuietly(read.value.project);
        }
        refreshStatus();
        return { ok: true, value: read.value.project };
      } catch (error) {
        return { ok: false, error: message(error) };
      }
    },
    async listProjects() {
      return records.listProjects(await db());
    },
    async renameProject(id, name) {
      if (openId === id && doc.get().id === id && !detached) {
        return { ok: false, error: "This project is open. Rename it in the title bar." };
      }
      const handle = await db();
      const read = await records.readProject(handle, id);
      if (!read.ok) return read;
      const project = { ...read.value.project, name };
      await handle.put("projects", { id, savedAt: read.value.savedAt, project });
      emitProjects();
      return { ok: true, value: { id, name, savedAt: read.value.savedAt, project } };
    },
    async duplicateProject(id) {
      try {
        if (openId === id) await flush();
        const handle = await db();
        const read = await records.readProject(handle, id);
        if (!read.ok) return read;
        const source = read.value.project;
        const copy: Project = {
          ...source,
          id: hex(randomBytes(16)).slice(2),
          name: `${source.name} copy`,
          deploy: { ...source.deploy, entropy: hex(randomBytes(11)) },
          predicted: [],
        };
        await handle.put("projects", { id: copy.id, savedAt: now(), project: copy });
        emitProjects();
        return { ok: true, value: copy };
      } catch (error) {
        return { ok: false, error: message(error) };
      }
    },
    async deleteProject(id) {
      try {
        const isOpen = openId === id;
        if (isOpen) await flush();
        const moved = await records.trashProject(await db(), id, now());
        if (moved.ok && isOpen) {
          detached = true;
          clearTimer();
          refreshStatus();
        }
        if (moved.ok) {
          emitProjects();
          emitDeployments(id);
          channel.post({ kind: "deployments", from: peerId, projectId: id });
        }
        return moved;
      } catch (error) {
        return { ok: false, error: message(error) };
      }
    },
    async restoreProject(id) {
      try {
        const restored = await records.restoreProject(await db(), id);
        if (restored.ok) {
          if (openId === id) {
            detached = false;
            schedule();
          }
          emitProjects();
          emitDeployments(id);
          channel.post({ kind: "deployments", from: peerId, projectId: id });
        }
        return restored;
      } catch (error) {
        return { ok: false, error: message(error) };
      }
    },
    async deleteForGood(id) {
      try {
        const gone = await records.deleteForGood(await db(), id);
        if (gone.ok) emitProjects();
        return gone;
      } catch (error) {
        return { ok: false, error: message(error) };
      }
    },
    async listTrash() {
      const handle = await db();
      const purged = await records.purgeTrash(handle, now());
      if (purged.length > 0) emitProjects();
      return records.listTrash(handle);
    },
    async trashCounts(id) {
      return records.trashCounts(await db(), id);
    },
    async importProject(project, imported) {
      try {
        await flush();
        const id = hex(randomBytes(16)).slice(2);
        const renamed: Project = { ...project, id };
        const marked = imported.map((d): Deployment => ({ ...d, projectId: id, fromFile: true }));
        const counts = await records.storeImport(await db(), renamed, marked, now());
        await open(renamed, false);
        emitProjects();
        if (counts.added > 0) {
          emitDeployments(id);
          channel.post({ kind: "deployments", from: peerId, projectId: id });
        }
        return { ok: true, value: { project: renamed, ...counts } };
      } catch (error) {
        return { ok: false, error: message(error) };
      }
    },
    async exportAll() {
      await flush().catch(() => {});
      const handle = await db();
      const files: ProjectFile[] = [];
      for (const summary of await records.listProjects(handle)) {
        files.push({ project: summary.project, deployments: await records.listDeployments(handle, summary.id) });
      }
      for (const entry of await records.listTrash(handle)) {
        files.push({ project: entry.project, deployments: entry.deployments });
      }
      return uniqueNames(files.map((file) => exportProjectFile(file.project, file.deployments)));
    },
    async clearDataCounts() {
      return records.clearDataCounts(await db());
    },
    async clearData() {
      clearTimer();
      pendingViewports.clear();
      detached = true;
      await records.clearAll(await db());
      refreshStatus();
      emitProjects();
      if (openId !== null) emitDeployments(openId);
    },
    subscribeProjects(listener) {
      projectListeners.add(listener);
      return () => void projectListeners.delete(listener);
    },
    async markExplicitSave() {
      const handle = await db();
      const first = (await handle.get("meta", META.explicitSave)) === undefined;
      let persistedNow: boolean | null = null;
      if (first) {
        await handle.put("meta", now(), META.explicitSave);
        persistedNow = storage?.persist ? await storage.persist().catch(() => false) : null;
      } else if (storage?.persisted) {
        persistedNow = await storage.persisted().catch(() => null);
      }
      let safariTip = false;
      if (isSafari(userAgent) && (await handle.get("meta", META.safariTip)) === undefined) {
        await handle.put("meta", now(), META.safariTip);
        safariTip = true;
      }
      return { first, persisted: persistedNow, safariTip };
    },
    async storageInfo() {
      const estimate = storage?.estimate ? await storage.estimate().catch(() => null) : null;
      const persistedNow = storage?.persisted ? await storage.persisted().catch(() => null) : null;
      return { usage: estimate?.usage ?? null, quota: estimate?.quota ?? null, persisted: persistedNow };
    },
    async close() {
      clearTimer();
      if (viewportTimer !== null) clearTimeout(viewportTimer);
      for (const stop of stops.splice(0)) stop();
      lock.dispose();
      channel.close();
      const handle = opened;
      opened = null;
      closed = true;
      (await handle?.catch(() => null))?.close();
    },
  };
  return persistence;
}
