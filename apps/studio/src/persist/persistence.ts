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
  exportProjectFile, type Deployment, type ExportFile, type Project, type Recipe, type Result,
} from "@lattice-studio/core";
import { openDB } from "idb";
import {
  commandRef, doc as studioDoc, log, now as kernelNow, randomBytes, settings, showBanner,
  type DeploymentsService, type DocumentState, type NewProjectOptions, type ProjectsService, type SaveStatus,
  type Viewport,
} from "@/contracts";
import { openChannel, type ChannelMessage } from "./channel";
import { DB_NAME, isQuotaError, META, openStudioDb, type StudioDb, type StudioSchema } from "./db";
import { createEditLock, type EditLockState } from "./lock";
import * as records from "./records";
import type { ClearDataCounts, ProjectSummary, RecordCounts, Restored, StoredEntry, TrashSummary } from "./records";

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
  /** How long Take over editing waits for the other tab to answer before stealing the lock, ms. */
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
  /**
   * Follows the document: autosave, the page's hide events and the other tabs. Idempotent. When nothing was
   * opened through this instance yet, the document (never stored: the boot's untitled project) gets its own id,
   * so it can't overwrite a stored project or share a lock with another fresh tab.
   */
  start(): void;
  /** Writes the pending save now (hide, close, lock handover, Save and reload). Starts synchronously when it can. */
  flush(): Promise<void>;
  /**
   * Opens the project last opened in this browser (else the last saved); null when there's none, or when
   * `proceed` says no once it's known which (the document changed meanwhile).
   */
  openLastProject(proceed?: () => boolean): Promise<Result<Project, string> | null>;
  editLock(): EditLockState;
  subscribeEditLock(listener: (state: EditLockState) => void): () => void;
  /** Take over editing / Take back editing: the other tab saves and lets go, then this tab loads its save. */
  takeOverEditing(): Promise<Result<Project, string>>;
  listProjects(): Promise<ProjectSummary[]>;
  /** Renames a stored project that isn't open here (the open one renames through `project.rename`). */
  renameProject(id: string, name: string): Promise<Result<ProjectSummary, string>>;
  /** Copies a project under a new id, with fresh salt entropy and no deployment records. */
  duplicateProject(id: string): Promise<Result<Project, string>>;
  /** Moves the project and its records to Recently deleted (no confirmation, spec L502). */
  deleteProject(id: string): Promise<Result<RecordCounts, string>>;
  /** Puts a project back; refuses when a newer copy is stored under its id. Logs records it couldn't put back. */
  restoreProject(id: string): Promise<Result<Restored, string>>;
  deleteForGood(id: string): Promise<Result<RecordCounts, string>>;
  /** Recently deleted. Projects there 30 days go; their records (but failed ones) stay in the deployments store. */
  listTrash(): Promise<TrashSummary[]>;
  /** What deleting a Recently deleted project for good would lose; null when it isn't there. */
  trashCounts(id: string): Promise<RecordCounts | null>;
  /** Stores an imported project file as a new project and opens it (records keep `fromFile`). */
  importProject(project: Project, deployments: readonly Deployment[]): Promise<Result<ImportResult, string>>;
  /**
   * Everything stored, as files: each project (Recently deleted included) as a `.lattice.json` with its records,
   * projects that don't read as stored (`unreadable-<id>.lattice.json`), and records whose project is gone
   * (`records-<projectId>.json`). Nothing Clear data counts is left out.
   */
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
/** IR L208: the database was upgraded by a newer Studio, and this tab saved before closing it. */
const UPDATED_TEXT = "A new version of Studio is ready";
const DELETED_DETAIL = "This project is in Recently deleted. Restore it to keep saving.";
const GONE_DETAIL = "This project was deleted from this browser's storage.";
const CLEARED_DETAIL = "Studio's data in this browser was cleared.";
/** Spec L494: taking over from another tab resets history, and the console says so. */
const TAKEOVER_LINE = "Took over editing from another tab. Undo history starts here.";
const UPDATED_BANNER = "persist.updated";

function hex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function newId(): string {
  return hex(randomBytes(16)).slice(2);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isViewport(value: unknown): value is Viewport {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v["x"] === "number" && typeof v["y"] === "number" && typeof v["zoom"] === "number";
}

function sameStatus(a: SaveStatus, b: SaveStatus): boolean {
  return a.state === b.state && a.text === b.text && a.detail === b.detail
    && JSON.stringify(a.action ?? null) === JSON.stringify(b.action ?? null);
}

/** Safari, which can clear site data after 7 days without a visit (spec L500). */
export function isSafari(userAgent: string): boolean {
  return /safari/i.test(userAgent) && !/chrome|chromium|crios|fxios|edg|android/i.test(userAgent);
}

function jsonFile(filename: string, value: unknown): ExportFile {
  return { filename, mime: "application/json", text: `${JSON.stringify(value, null, 2)}\n` };
}

function fileSafe(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 64) || "project";
}

function exportEntry(entry: StoredEntry): ExportFile {
  if (entry.kind === "project") return exportProjectFile(entry.project, entry.deployments);
  if (entry.kind === "raw") {
    return jsonFile(`unreadable-${fileSafe(entry.id)}.lattice.json`, { project: entry.project, deployments: entry.deployments });
  }
  return jsonFile(`records-${fileSafe(entry.projectId)}.json`, { projectId: entry.projectId, deployments: entry.deployments });
}

function uniqueNames(files: ExportFile[]): ExportFile[] {
  const seen = new Map<string, number>();
  return files.map((file) => {
    const count = (seen.get(file.filename) ?? 0) + 1;
    seen.set(file.filename, count);
    if (count === 1) return file;
    return { ...file, filename: file.filename.replace(/(\.lattice)?\.json$/, (ext) => `-${count}${ext}`) };
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
  const peerId = newId();
  const channel = openChannel(`${dbName}:tabs`);

  // ── Database ────────────────────────────────────────────────────────────────────────────────────────

  let opened: Promise<StudioDb> | null = null;
  /** The open connection, once it has opened: saves start synchronously on it. */
  let handle: StudioDb | null = null;
  /** A newer Studio upgraded the database: this connection closed. */
  let updated = false;
  let closed = false;

  const db = (): Promise<StudioDb> => {
    if (updated) return Promise.reject(new Error(UPDATED_TEXT));
    if (closed) return Promise.reject(new Error("Storage is closed."));
    opened ??= openStudioDb(dbName, { onVersionChange: versionChanged }).then(async (connection) => {
      const purged = await records.purgeTrash(connection, now()).catch(() => []);
      if (purged.length > 0) emitProjects({ gone: purged });
      handle = connection;
      return connection;
    });
    return opened;
  };

  function versionChanged(): void {
    const closing = opened;
    void flush()
      .catch(() => {})
      .then(() => {
        updated = true;
        handle = null;
        lock.release();
        refreshStatus();
        showBanner(UPDATED_BANNER, { text: UPDATED_TEXT, tone: "info", actions: [commandRef("app.reload")] });
        return closing;
      })
      .then((connection) => connection?.close())
      .catch(() => {});
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
    const unsaved = doc.get().id === openId && doc.get() !== persisted;
    if (updated) return unsaved ? { state: "not-saved", text: "Not saved", detail: UPDATED_TEXT } : SAVED;
    if (detached !== null) return unsaved ? { state: "not-saved", text: "Not saved", detail: detached } : SAVED;
    if (timer !== null || inFlight > 0) return SAVING;
    if (failure?.quota) return { state: "not-saved", text: FULL_TEXT, action: commandRef("project.saveCopy") };
    if (failure) return { state: "not-saved", text: "Not saved", detail: failure.reason };
    return SAVED;
  }

  function refreshStatus(): void {
    const next = computeStatus();
    if (sameStatus(next, status)) return;
    status = next;
    for (const listener of Array.from(statusListeners)) listener(next);
  }

  // ── The open project and autosave ───────────────────────────────────────────────────────────────────

  /** The project this instance saves. */
  let openId: string | null = null;
  /** The value last written or read for `openId`; the document differs from it when there's something to save. */
  let persisted: Project | null = null;
  /** This instance knows `openId` is stored: a save that finds it missing means another tab deleted it. */
  let stored = false;
  /** Why the open project isn't saved any more (deleted, cleared), or null. */
  let detached: string | null = null;
  /** The value of the latest write started; not started again while it's in flight. */
  let submitted: Project | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = 0;
  /** Settles once every write started so far has (IndexedDB runs them in order). */
  let lastWrite: Promise<void> = Promise.resolve();
  /** Set while this instance loads the document itself, so the load isn't broadcast as an edit. */
  let quiet = 0;
  /** The lock claim in flight for the open project; a save waits for it to know whether it may write. */
  let claiming: Promise<boolean> | null = null;

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
    return openId !== null && detached === null && !updated && project.id === openId
      && project !== persisted && project !== submitted;
  };

  function detach(reason: string): void {
    clearTimer();
    detached = reason;
    refreshStatus();
  }

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

  /** Counts a write in flight, for the status and for `lastWrite`. */
  function track(write: Promise<void>): Promise<void> {
    inFlight += 1;
    refreshStatus();
    const done = write.finally(() => {
      inFlight -= 1;
      refreshStatus();
    });
    lastWrite = Promise.all([lastWrite, done]).then(() => {});
    return done;
  }

  const pendingViewports = new Map<string, Viewport>();
  let viewportTimer: ReturnType<typeof setTimeout> | null = null;

  function takeViewports(): [string, Viewport][] {
    if (viewportTimer !== null) clearTimeout(viewportTimer);
    viewportTimer = null;
    const entries = Array.from(pendingViewports);
    pendingViewports.clear();
    return entries;
  }

  function requeueViewports(entries: readonly [string, Viewport][]): void {
    for (const [id, viewport] of entries) if (!pendingViewports.has(id)) pendingViewports.set(id, viewport);
  }

  /** Writes `project` on `connection`. The transaction starts before this yields. */
  async function write(
    connection: StudioDb, project: Project, mustExist: boolean, viewports: [string, Viewport][],
  ): Promise<void> {
    submitted = project;
    try {
      const outcome = await records.writeProject(connection, project, now(), { mustExist, viewports });
      if (outcome === "written") {
        if (project.id === openId) {
          persisted = project;
          stored = true;
        }
        failure = null;
      } else if (project.id === openId) {
        detach(outcome === "trashed" ? DELETED_DETAIL : GONE_DETAIL);
      }
    } catch (error) {
      requeueViewports(viewports);
      const quota = isQuotaError(error);
      const firstTime = !failure || failure.quota !== quota;
      failure = { quota, reason: message(error) };
      if (firstTime && !updated) log({ tag: "Error", text: quota ? `${FULL_TEXT}.` : `Not saved: ${message(error)}` });
    } finally {
      if (submitted === project) submitted = null;
    }
  }

  /** Starts the save (and pending viewports) on an open connection, synchronously. */
  function flushOn(connection: StudioDb): Promise<void> {
    clearTimer();
    const viewports = takeViewports();
    const project = doc.get();
    if (dirty() && holds(project.id)) return track(write(connection, project, stored, viewports));
    if (viewports.length > 0) {
      return track(records.writeViewports(connection, viewports).catch(() => requeueViewports(viewports)));
    }
    refreshStatus();
    return lastWrite;
  }

  function flush(): Promise<void> {
    clearTimer();
    // The common case (pagehide, visibilitychange, a lock handover): the connection is open and the lock
    // known, so the transaction is created before this returns.
    if (handle && claiming === null) return flushOn(handle);
    return (async () => {
      const connection = await db();
      if (claiming) await claiming;
      await flushOn(connection);
    })();
  }

  /** Saves until nothing is pending: edits made while a save ran are saved too (before a lock handover). */
  async function flushUntilClean(): Promise<void> {
    for (let round = 0; round < 10; round++) {
      await flush();
      if (!dirty() || !holds(doc.get().id)) return;
    }
  }

  /** Claims the lock for `id` once `before` settles; once held, anything unsaved is scheduled. */
  function claim(id: string, before: Promise<unknown> = Promise.resolve()): Promise<boolean> {
    if (updated) return Promise.resolve(false);
    const pending = before.catch(() => {}).then(() => lock.claim(id)).catch(() => false);
    claiming = pending;
    return pending.then((held) => {
      if (claiming === pending) claiming = null;
      if (openId === id) schedule();
      return held;
    });
  }

  /**
   * The document switched to a project this instance didn't open (a migration, a link, a test seed). The
   * previous project's pending save is written first, while its lock is still held.
   */
  function adopt(project: Project, previous: Project): void {
    clearTimer();
    let before: Promise<unknown> = Promise.resolve();
    if (openId !== null && previous.id === openId && detached === null && !updated
      && previous !== persisted && previous !== submitted && holds(openId)) {
      const mustExist = stored;
      const views = takeViewports();
      before = track(handle ? write(handle, previous, mustExist, views) : db().then((c) => write(c, previous, mustExist, views)));
    }
    openId = project.id;
    persisted = null;
    stored = false;
    detached = null;
    failure = null;
    void claim(project.id, before);
    refreshStatus();
  }

  function onDocChange(state: DocumentState, previous: DocumentState): void {
    if (state.project === previous.project && state.lastChange?.revision === previous.lastChange?.revision) return;
    const project = state.project;
    if (project.id !== openId) {
      adopt(project, previous.project);
      return;
    }
    if (quiet > 0) return;
    if (detached !== null || updated) {
      refreshStatus();
      return;
    }
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
    beforeHandover: () => flushUntilClean(),
    onChange(state) {
      if (state.state !== "held") clearTimer();
      refreshStatus();
      for (const listener of Array.from(lockListeners)) listener(state);
    },
    onError(error) {
      log({
        tag: "Error",
        text: `Couldn't coordinate editing with other tabs. This tab edits and saves on its own. ${message(error)}`,
      });
    },
  });

  // ── The projects list and deployment records (outside the lock) ─────────────────────────────────────

  /** Stored records that no longer parse, each logged once: they stay stored and are exported as stored. */
  const reported = new Set<string>();
  const unreadable: records.Unreadable = (id, reason) => {
    if (reported.has(id)) return;
    reported.add(id);
    log({ tag: "Error", text: `Couldn't read the stored project ${id}. ${reason}` });
  };

  const deploymentListeners = new Set<(projectId: string) => void>();
  const emitDeployments = (projectId: string, remote = false) => {
    if (!remote) channel.post({ kind: "deployments", from: peerId, projectId });
    for (const listener of Array.from(deploymentListeners)) listener(projectId);
  };

  type ProjectsChange = Omit<Extract<ChannelMessage, { kind: "projects" }>, "kind" | "from">;
  const projectListeners = new Set<() => void>();
  const emitProjects = (change: ProjectsChange = {}, remote = false) => {
    if (!remote) channel.post({ kind: "projects", from: peerId, ...change });
    for (const listener of Array.from(projectListeners)) listener();
  };

  /** After a newer Studio closed the database, a record still gets written: on a connection at whatever version. */
  async function putAfterUpdate(deployment: Deployment): Promise<void> {
    const connection = await openDB<StudioSchema>(dbName);
    try {
      await connection.put("deployments", records.normalizeRecord(deployment));
    } finally {
      connection.close();
    }
  }

  const deployments: DeploymentsService = {
    async listDeployments(projectId) {
      return records.listDeployments(await db(), projectId);
    },
    async putDeployment(deployment) {
      if (updated) await putAfterUpdate(deployment);
      else await records.putDeployment(await db(), deployment);
      emitDeployments(deployment.projectId);
    },
    subscribe(listener) {
      deploymentListeners.add(listener);
      return () => void deploymentListeners.delete(listener);
    },
  };

  // ── Page events and the channel ─────────────────────────────────────────────────────────────────────

  const stops: (() => void)[] = [];
  let started = false;

  const onHide = () => {
    if (page?.document.visibilityState === "hidden") void flush().catch(() => {});
  };
  const onPageHide = () => void flush().catch(() => {});

  function onMessage(msg: ChannelMessage): void {
    if (msg.from === peerId) return;
    if (msg.kind === "deployments") emitDeployments(msg.projectId, true);
    else if (msg.kind === "projects") {
      const id = openId;
      if (id !== null) {
        if (msg.cleared) {
          persisted = null;
          detach(CLEARED_DETAIL);
        } else if (msg.trashed?.includes(id)) detach(DELETED_DETAIL);
        else if (msg.gone?.includes(id)) detach(GONE_DETAIL);
        else if (msg.restored?.includes(id) && detached !== null) {
          detached = null;
          stored = true;
          schedule();
        }
      }
      emitProjects({}, true);
    } else if (msg.kind === "change" && started && msg.id === openId && !holds(msg.id)) {
      persisted = msg.project;
      loadQuietly(msg.project);
    }
  }
  stops.push(channel.subscribe(onMessage));

  // ── Projects ────────────────────────────────────────────────────────────────────────────────────────

  function newProject(recipe: Recipe, name: string, opts?: NewProjectOptions): Project {
    return {
      id: newId(),
      name,
      recipe,
      layout: opts?.layout ?? {},
      deploy: { path: settings.get().defaultPath, entropy: hex(randomBytes(11)), scope: "every-chain" },
      provenance: opts?.provenance ?? {},
      predicted: [],
    };
  }

  /** Makes `project` the open document and claims its lock; writes it when `save` (a new project). */
  async function open(project: Project, save: boolean): Promise<void> {
    clearTimer();
    openId = project.id;
    persisted = save ? null : project;
    stored = !save;
    detached = null;
    failure = null;
    loadQuietly(project);
    const held = await claim(project.id);
    if (save && held) await flush();
    else if (!save) await (await db()).put("meta", project.id, META.lastProject);
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
        // Already open here, as read from or written to storage (never the boot's unsaved document).
        if (openId === id && current.id === id && detached === null && stored) return { ok: true, value: current };
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
        const saved = await (await db()).get("meta", META.viewport(id));
        return isViewport(saved) ? saved : null;
      } catch {
        return null;
      }
    },
    saveViewport(id, viewport) {
      pendingViewports.set(id, { x: viewport.x, y: viewport.y, zoom: viewport.zoom });
      if (viewportTimer !== null) clearTimeout(viewportTimer);
      viewportTimer = setTimeout(() => {
        viewportTimer = null;
        void db().then((connection) => {
          const entries = takeViewports();
          if (entries.length === 0) return undefined;
          return track(records.writeViewports(connection, entries).catch(() => requeueViewports(entries)));
        }).catch(() => {});
      }, quietMs);
    },
  };

  const persistence: Persistence = {
    dbName,
    projects,
    deployments,
    start() {
      if (started) return;
      started = true;
      stops.push(doc.subscribe(onDocChange));
      if (page) {
        page.document.addEventListener("visibilitychange", onHide);
        page.window.addEventListener("pagehide", onPageHide);
        stops.push(() => {
          page.document.removeEventListener("visibilitychange", onHide);
          page.window.removeEventListener("pagehide", onPageHide);
        });
      }
      if (openId !== null) return;
      const fresh: Project = { ...doc.get(), id: newId() };
      openId = fresh.id;
      persisted = fresh;
      stored = false;
      loadQuietly(fresh);
      void claim(fresh.id);
    },
    flush,
    async openLastProject(proceed) {
      try {
        const connection = await db();
        const last = await connection.get("meta", META.lastProject);
        const id = typeof last === "string" && (await connection.getKey("projects", last)) !== undefined
          ? last
          : (await records.listProjects(connection, unreadable))[0]?.id;
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
      if (updated) return { ok: false, error: UPDATED_TEXT };
      try {
        const held = await lock.takeOver(id);
        if (!held) return { ok: false, error: "Couldn't take over editing. Another tab kept it." };
        const read = await records.readProject(await db(), id);
        if (!read.ok) return read;
        if (openId === id) {
          persisted = read.value.project;
          stored = true;
          loadQuietly(read.value.project, TAKEOVER_LINE);
        }
        refreshStatus();
        return { ok: true, value: read.value.project };
      } catch (error) {
        return { ok: false, error: message(error) };
      }
    },
    async listProjects() {
      return records.listProjects(await db(), unreadable);
    },
    async renameProject(id, name) {
      if (openId === id && doc.get().id === id && detached === null) {
        return { ok: false, error: "This project is open. Rename it in the title bar." };
      }
      const connection = await db();
      const read = await records.readProject(connection, id);
      if (!read.ok) return read;
      const project = { ...read.value.project, name };
      await connection.put("projects", { id, savedAt: read.value.savedAt, project });
      emitProjects();
      return { ok: true, value: { id, name, savedAt: read.value.savedAt, project } };
    },
    async duplicateProject(id) {
      try {
        if (openId === id) await flush();
        const connection = await db();
        const read = await records.readProject(connection, id);
        if (!read.ok) return read;
        const source = read.value.project;
        const copy: Project = {
          ...source,
          id: newId(),
          name: `${source.name} copy`,
          deploy: { ...source.deploy, entropy: hex(randomBytes(11)) },
          predicted: [],
        };
        await connection.put("projects", { id: copy.id, savedAt: now(), project: copy });
        emitProjects();
        return { ok: true, value: copy };
      } catch (error) {
        return { ok: false, error: message(error) };
      }
    },
    async deleteProject(id) {
      try {
        if (openId === id) await flush();
        const moved = await records.trashProject(await db(), id, now());
        if (moved.ok) {
          if (openId === id) detach(DELETED_DETAIL);
          emitProjects({ trashed: [id] });
          emitDeployments(id);
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
          const { project, skipped } = restored.value;
          if (skipped > 0) {
            log({
              tag: "Note",
              text: `Restored ${project.name}. ${skipped} of its deployment records ${skipped === 1 ? "stays" : "stay"} with the project that holds ${skipped === 1 ? "that address" : "those addresses"} now.`,
            });
          }
          if (openId === id && detached !== null) {
            detached = null;
            stored = true;
            schedule();
          }
          emitProjects({ restored: [id] });
          emitDeployments(id);
        }
        return restored;
      } catch (error) {
        return { ok: false, error: message(error) };
      }
    },
    async deleteForGood(id) {
      try {
        const gone = await records.deleteForGood(await db(), id);
        if (gone.ok) emitProjects({ gone: [id] });
        return gone;
      } catch (error) {
        return { ok: false, error: message(error) };
      }
    },
    async listTrash() {
      const connection = await db();
      const purged = await records.purgeTrash(connection, now());
      if (purged.length > 0) {
        emitProjects({ gone: purged });
        for (const id of purged) emitDeployments(id);
      }
      return records.listTrash(connection, unreadable);
    },
    async trashCounts(id) {
      return records.trashCounts(await db(), id);
    },
    async importProject(project, imported) {
      try {
        await flush();
        const id = newId();
        const renamed: Project = { ...project, id };
        const marked = imported.map((d): Deployment => ({ ...d, projectId: id, fromFile: true }));
        const counts = await records.storeImport(await db(), renamed, marked, now());
        await open(renamed, false);
        emitProjects();
        if (counts.added > 0) emitDeployments(id);
        return { ok: true, value: { project: renamed, ...counts } };
      } catch (error) {
        return { ok: false, error: message(error) };
      }
    },
    async exportAll() {
      await flush().catch(() => {});
      const entries = await records.listEverything(await db(), unreadable);
      return uniqueNames(entries.map(exportEntry));
    },
    async clearDataCounts() {
      return records.clearDataCounts(await db());
    },
    async clearData() {
      clearTimer();
      pendingViewports.clear();
      await records.clearAll(await db());
      persisted = null;
      detach(CLEARED_DETAIL);
      emitProjects({ cleared: true });
      if (openId !== null) emitDeployments(openId);
    },
    subscribeProjects(listener) {
      projectListeners.add(listener);
      return () => void projectListeners.delete(listener);
    },
    async markExplicitSave() {
      const connection = await db();
      const first = (await connection.get("meta", META.explicitSave)) === undefined;
      let persistedNow: boolean | null = null;
      if (first) {
        await connection.put("meta", now(), META.explicitSave);
        persistedNow = storage?.persist ? await storage.persist().catch(() => false) : null;
      } else if (storage?.persisted) {
        persistedNow = await storage.persisted().catch(() => null);
      }
      let safariTip = false;
      if (isSafari(userAgent) && (await connection.get("meta", META.safariTip)) === undefined) {
        await connection.put("meta", now(), META.safariTip);
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
      viewportTimer = null;
      for (const stop of stops.splice(0)) stop();
      lock.dispose();
      channel.close();
      const connection = opened;
      opened = null;
      handle = null;
      closed = true;
      (await connection?.catch(() => null))?.close();
    },
  };
  return persistence;
}
