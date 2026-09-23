/**
 * Reads and writes over an open database, without the open project, autosave or the lock: the projects list,
 * deployment records (outside the lock, spec L292), Recently deleted (30 days), counts for the dialogs that
 * delete for good, and imports.
 */
import {
  formatParseIssue, parseProject, toChecksum, type Deployment, type Project, type Result,
} from "@lattice-studio/core";
import type { Viewport } from "@/contracts";
import { META, type StudioDb, type TrashRecord } from "./db";

/** Recently deleted keeps a project this long (spec L502). */
export const TRASH_DAYS = 30;
export const TRASH_MS = TRASH_DAYS * 24 * 60 * 60 * 1000;

/** A row in the Projects dialog. */
export type ProjectSummary = {
  id: string;
  name: string;
  /** Epoch ms of the last save. */
  savedAt: number;
  project: Project;
};

/** A row in Recently deleted. */
export type TrashSummary = {
  id: string;
  name: string;
  deletedAt: number;
  /** When it goes for good (epoch ms). */
  expiresAt: number;
  project: Project;
  deployments: Deployment[];
  counts: RecordCounts;
};

/**
 * What deleting for good would lose. `deployed` counts the records whose address may hold a diamond (every
 * status but `failed`): "This deletes the only record of 2 deployed addresses." (spec L502).
 */
export type RecordCounts = { records: number; deployed: number };

/** What Clear data would delete (spec L637). */
export type ClearDataCounts = { projects: number; trashed: number } & RecordCounts;

export function countRecords(deployments: readonly Deployment[]): RecordCounts {
  return { records: deployments.length, deployed: deployments.filter((d) => d.status !== "failed").length };
}

/** The key form every record is stored under: EIP-55 addresses, as C1's `parseProjectFile` writes them. */
export function normalizeRecord(deployment: Deployment): Deployment {
  return { ...deployment, address: toChecksum(deployment.address) };
}

/** A stored project, migrated forward and validated (C1). */
export function readProjectValue(value: unknown): Result<Project, string> {
  const parsed = parseProject(value, { catalogs: [], source: "db" });
  if (!parsed.ok) return { ok: false, error: parsed.error.map(formatParseIssue).join(" ") };
  return { ok: true, value: parsed.value.value };
}

export async function readProject(db: StudioDb, id: string): Promise<Result<{ project: Project; savedAt: number }, string>> {
  const record = await db.get("projects", id);
  if (!record) return { ok: false, error: "This project isn't in this browser's storage." };
  const project = readProjectValue(record.project);
  return project.ok ? { ok: true, value: { project: project.value, savedAt: record.savedAt } } : project;
}

/** Told about a stored record that no longer parses; it stays stored, but isn't listed. */
export type Unreadable = (id: string, reason: string) => void;

/** Stored projects, most recently saved first. Records that no longer parse are reported and left out. */
export async function listProjects(db: StudioDb, unreadable?: Unreadable): Promise<ProjectSummary[]> {
  const records = await db.getAll("projects");
  const out: ProjectSummary[] = [];
  for (const record of records) {
    const project = readProjectValue(record.project);
    if (project.ok) out.push({ id: record.id, name: project.value.name, savedAt: record.savedAt, project: project.value });
    else unreadable?.(record.id, project.error);
  }
  return out.sort((a, b) => b.savedAt - a.savedAt || a.name.localeCompare(b.name));
}

/**
 * What a save found: written, or not written because the stored project was deleted meanwhile (by another
 * tab: moved to Recently deleted, or gone for good or cleared), which the writer must not undo.
 */
export type WriteOutcome = "written" | "trashed" | "gone";

export type WriteOptions = {
  /** The writer knows the project was stored: if it's missing now, someone deleted it; don't bring it back. */
  mustExist: boolean;
  /** Viewports to write in the same transaction. */
  viewports?: readonly (readonly [string, Viewport])[];
};

/**
 * Saves the open project (and pending viewports) and remembers it as the last one. The transaction and its
 * first requests start synchronously, before this function first yields, so a save started in `pagehide` is
 * already queued when the handler returns. A failed commit rejects with the transaction's error.
 */
export async function writeProject(
  db: StudioDb,
  project: Project,
  savedAt: number,
  options: WriteOptions,
): Promise<WriteOutcome> {
  const tx = db.transaction(["projects", "meta", "trash"], "readwrite");
  const projects = tx.objectStore("projects");
  const meta = tx.objectStore("meta");
  const requests: Promise<unknown>[] = (options.viewports ?? []).map(([id, viewport]) => meta.put(viewport, META.viewport(id)));
  let outcome: Promise<WriteOutcome>;
  if (!options.mustExist) {
    requests.push(projects.put({ id: project.id, savedAt, project }), meta.put(project.id, META.lastProject));
    outcome = Promise.resolve("written");
  } else {
    const stored = projects.getKey(project.id);
    const trashed = tx.objectStore("trash").getKey(project.id);
    outcome = stored.then(async (key): Promise<WriteOutcome> => {
      if (key === undefined) return (await trashed) === undefined ? "gone" : "trashed";
      await Promise.all([projects.put({ id: project.id, savedAt, project }), meta.put(project.id, META.lastProject)]);
      return "written";
    });
  }
  try {
    const [result] = await Promise.all([outcome, ...requests, tx.done]);
    return result;
  } catch (error) {
    throw tx.error ?? error;
  }
}

/** Writes pending viewports on their own (nothing else to save). Starts synchronously, like `writeProject`. */
export async function writeViewports(db: StudioDb, viewports: readonly (readonly [string, Viewport])[]): Promise<void> {
  const tx = db.transaction("meta", "readwrite");
  await Promise.all([...viewports.map(([id, viewport]) => tx.store.put(viewport, META.viewport(id))), tx.done]);
}

export function listDeployments(db: StudioDb, projectId: string): Promise<Deployment[]> {
  return db.getAllFromIndex("deployments", "projectId", projectId);
}

export async function putDeployment(db: StudioDb, deployment: Deployment): Promise<void> {
  await db.put("deployments", normalizeRecord(deployment));
}

/**
 * Adds records whose `[chainId, address]` isn't stored yet; never overwrites one (an imported file can't
 * replace a live record). Returns how many were added and skipped.
 */
async function addRecords(
  store: { get(key: [number, string]): Promise<Deployment | undefined>; add(value: Deployment): Promise<unknown> },
  deployments: readonly Deployment[],
): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  for (const deployment of deployments.map(normalizeRecord)) {
    if (await store.get([deployment.chainId, deployment.address])) {
      skipped += 1;
      continue;
    }
    await store.add(deployment);
    added += 1;
  }
  return { added, skipped };
}

/** Stores an imported project and its records (already given their new project id). */
export async function storeImport(
  db: StudioDb,
  project: Project,
  deployments: readonly Deployment[],
  savedAt: number,
): Promise<{ added: number; skipped: number }> {
  const tx = db.transaction(["projects", "deployments"], "readwrite");
  await tx.objectStore("projects").put({ id: project.id, savedAt, project });
  const counts = await addRecords(tx.objectStore("deployments"), deployments);
  await tx.done;
  return counts;
}

/** Moves a project and its records to Recently deleted. Resolves the counts moved, or an error. */
export async function trashProject(db: StudioDb, id: string, deletedAt: number): Promise<Result<RecordCounts, string>> {
  const tx = db.transaction(["projects", "deployments", "trash"], "readwrite");
  const projects = tx.objectStore("projects");
  const deployments = tx.objectStore("deployments");
  const record = await projects.get(id);
  if (!record) {
    await tx.done;
    return { ok: false, error: "This project isn't in this browser's storage." };
  }
  const records = await deployments.index("projectId").getAll(id);
  const entry: TrashRecord = { id, deletedAt, savedAt: record.savedAt, project: record.project, deployments: records };
  await tx.objectStore("trash").put(entry);
  await projects.delete(id);
  for (const d of records) await deployments.delete([d.chainId, d.address]);
  await tx.done;
  return { ok: true, value: countRecords(records) };
}

/** What a restore brought back. `skipped` records kept the address another project's record holds now. */
export type Restored = { project: Project; restored: number; skipped: number };

/**
 * Puts a project back from Recently deleted. Records whose `[chainId, address]` was reused meanwhile stay as
 * they are (and are counted). Refuses when a project with this id is stored again, so the newer copy wins.
 */
export async function restoreProject(db: StudioDb, id: string): Promise<Result<Restored, string>> {
  const tx = db.transaction(["projects", "deployments", "trash"], "readwrite");
  const entry = await tx.objectStore("trash").get(id);
  if (!entry) {
    await tx.done;
    return { ok: false, error: "This project isn't in Recently deleted." };
  }
  const project = readProjectValue(entry.project);
  if (!project.ok) {
    await tx.done;
    return project;
  }
  if ((await tx.objectStore("projects").getKey(id)) !== undefined) {
    await tx.done;
    return { ok: false, error: "A newer copy of this project is already in your projects. Recently deleted keeps this one." };
  }
  await tx.objectStore("projects").put({ id, savedAt: entry.savedAt, project: entry.project });
  const counts = await addRecords(tx.objectStore("deployments"), entry.deployments);
  await tx.objectStore("trash").delete(id);
  await tx.done;
  return { ok: true, value: { project: project.value, restored: counts.added, skipped: counts.skipped } };
}

/** Deletes a project in Recently deleted for good. Resolves what went with it. */
export async function deleteForGood(db: StudioDb, id: string): Promise<Result<RecordCounts, string>> {
  const tx = db.transaction(["trash", "meta"], "readwrite");
  const entry = await tx.objectStore("trash").get(id);
  if (!entry) {
    await tx.done;
    return { ok: false, error: "This project isn't in Recently deleted." };
  }
  await tx.objectStore("trash").delete(id);
  await tx.objectStore("meta").delete(META.viewport(id));
  await tx.done;
  return { ok: true, value: countRecords(entry.deployments) };
}

/** What expiry did: the project ids that went, and records not put back because their key is stored again. */
export type Purged = { gone: string[]; skipped: number };

/**
 * Deletes the projects that have been in Recently deleted for 30 days or more. Deployment records are never
 * deleted silently (spec L292): every record whose status isn't `failed` goes back to the deployments store,
 * where it stays (listed by its project id, exported, counted by Clear data). A record whose
 * `[chainId, address]` another record holds now stays out, and is counted in `skipped`.
 */
export async function purgeTrash(db: StudioDb, now: number): Promise<Purged> {
  const tx = db.transaction(["trash", "meta", "deployments"], "readwrite");
  const gone: string[] = [];
  let skipped = 0;
  for (const entry of await tx.objectStore("trash").getAll()) {
    if (now - entry.deletedAt < TRASH_MS) continue;
    gone.push(entry.id);
    const kept = await addRecords(tx.objectStore("deployments"), entry.deployments.filter((d) => d.status !== "failed"));
    skipped += kept.skipped;
    await tx.objectStore("trash").delete(entry.id);
    await tx.objectStore("meta").delete(META.viewport(entry.id));
  }
  await tx.done;
  return { gone, skipped };
}

export async function listTrash(db: StudioDb, unreadable?: Unreadable): Promise<TrashSummary[]> {
  const out: TrashSummary[] = [];
  for (const entry of await db.getAll("trash")) {
    const project = readProjectValue(entry.project);
    if (!project.ok) {
      unreadable?.(entry.id, project.error);
      continue;
    }
    out.push({
      id: entry.id,
      name: project.value.name,
      deletedAt: entry.deletedAt,
      expiresAt: entry.deletedAt + TRASH_MS,
      project: project.value,
      deployments: entry.deployments,
      counts: countRecords(entry.deployments),
    });
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}

export async function trashCounts(db: StudioDb, id: string): Promise<RecordCounts | null> {
  const entry = await db.get("trash", id);
  return entry ? countRecords(entry.deployments) : null;
}

export async function clearDataCounts(db: StudioDb): Promise<ClearDataCounts> {
  const [projects, trash, deployments] = await Promise.all([
    db.count("projects"), db.getAll("trash"), db.getAll("deployments"),
  ]);
  const all = [...deployments, ...trash.flatMap((entry) => entry.deployments)];
  return { projects, trashed: trash.length, ...countRecords(all) };
}

/** Everything stored, for Export all: nothing Clear data would delete is left out. */
export type StoredEntry =
  /** A project that reads, live or in Recently deleted, with its records. */
  | { kind: "project"; project: Project; deployments: Deployment[] }
  /** A project that doesn't read (a newer schema): exported as stored. */
  | { kind: "raw"; id: string; project: unknown; deployments: Deployment[] }
  /** Records whose project is gone (expired from Recently deleted), by project id. */
  | { kind: "orphans"; projectId: string; deployments: Deployment[] };

export async function listEverything(db: StudioDb, unreadable?: Unreadable): Promise<StoredEntry[]> {
  const [projects, trash, deployments] = await Promise.all([
    db.getAll("projects"), db.getAll("trash"), db.getAll("deployments"),
  ]);
  const byProject = new Map<string, Deployment[]>();
  for (const d of deployments) byProject.set(d.projectId, [...(byProject.get(d.projectId) ?? []), d]);
  const out: StoredEntry[] = [];
  const add = (id: string, value: unknown, records: Deployment[]) => {
    const project = readProjectValue(value);
    if (project.ok) out.push({ kind: "project", project: project.value, deployments: records });
    else {
      unreadable?.(id, project.error);
      out.push({ kind: "raw", id, project: value, deployments: records });
    }
  };
  for (const record of projects) {
    add(record.id, record.project, byProject.get(record.id) ?? []);
    byProject.delete(record.id);
  }
  for (const entry of trash) add(entry.id, entry.project, entry.deployments);
  for (const [projectId, records] of byProject) out.push({ kind: "orphans", projectId, deployments: records });
  return out;
}

/** Empties every store (Clear data). */
export async function clearAll(db: StudioDb): Promise<void> {
  const tx = db.transaction(["projects", "deployments", "trash", "meta"], "readwrite");
  await Promise.all([
    tx.objectStore("projects").clear(),
    tx.objectStore("deployments").clear(),
    tx.objectStore("trash").clear(),
    tx.objectStore("meta").clear(),
    tx.done,
  ]);
}
