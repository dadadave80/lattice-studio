/**
 * Reads and writes over an open database, without the open project, autosave or the lock: the projects list,
 * deployment records (outside the lock, spec L292), Recently deleted (30 days), counts for the dialogs that
 * delete for good, and imports.
 */
import {
  formatParseIssue, parseProject, toChecksum, type Deployment, type Project, type Result,
} from "@lattice-studio/core";
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

/** Saves the open project and remembers it as the last one. A failed commit rejects with the transaction's error. */
export async function writeProject(db: StudioDb, project: Project, savedAt: number): Promise<void> {
  const tx = db.transaction(["projects", "meta"], "readwrite");
  try {
    await Promise.all([
      tx.objectStore("projects").put({ id: project.id, savedAt, project }),
      tx.objectStore("meta").put(project.id, META.lastProject),
      tx.done,
    ]);
  } catch (error) {
    throw tx.error ?? error;
  }
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

/** Puts a project back from Recently deleted; records whose key was reused meanwhile stay as they are. */
export async function restoreProject(db: StudioDb, id: string): Promise<Result<Project, string>> {
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
  await tx.objectStore("projects").put({ id, savedAt: entry.savedAt, project: entry.project });
  await addRecords(tx.objectStore("deployments"), entry.deployments);
  await tx.objectStore("trash").delete(id);
  await tx.done;
  return { ok: true, value: project.value };
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

/** Deletes what's been in Recently deleted for 30 days or more. Resolves the ids that went. */
export async function purgeTrash(db: StudioDb, now: number): Promise<string[]> {
  const tx = db.transaction(["trash", "meta"], "readwrite");
  const gone: string[] = [];
  for (const entry of await tx.objectStore("trash").getAll()) {
    if (now - entry.deletedAt < TRASH_MS) continue;
    gone.push(entry.id);
    await tx.objectStore("trash").delete(entry.id);
    await tx.objectStore("meta").delete(META.viewport(entry.id));
  }
  await tx.done;
  return gone;
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
