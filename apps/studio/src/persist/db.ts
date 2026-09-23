/**
 * The `lattice-studio` IndexedDB database (spec L27 decision 15, L292): projects, deployment records in their
 * own store keyed by `[chainId, address]`, Recently deleted, and small per-browser values (`meta`). Stored
 * projects are read back through C1's `parseProject`, which runs the forward migrations.
 */
import type { Deployment } from "@lattice-studio/core";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export const DB_NAME = "lattice-studio";
/** Bump with an `upgrade` step when a store or index changes. */
export const DB_VERSION = 1;

/** A project as autosave stores it. `project` is read back through `parseProject` (migrations). */
export type ProjectRecord = { id: string; savedAt: number; project: unknown };

/** A project in Recently deleted, with the deployment records that went with it. */
export type TrashRecord = {
  id: string;
  deletedAt: number;
  savedAt: number;
  project: unknown;
  deployments: Deployment[];
};

export type StudioSchema = DBSchema & {
  projects: { key: string; value: ProjectRecord };
  deployments: { key: [number, string]; value: Deployment; indexes: { projectId: string } };
  trash: { key: string; value: TrashRecord };
  meta: { key: string; value: unknown };
};

export type StudioDb = IDBPDatabase<StudioSchema>;

export type OpenOptions = {
  /**
   * Another tab opened a newer version (`newVersion`), or deleted the database (`null`): close this connection
   * (after the handler) and ask to reload.
   */
  onVersionChange(newVersion: number | null): void;
};

/** Opens (and creates or upgrades) the database. */
export function openStudioDb(name: string, options: OpenOptions): Promise<StudioDb> {
  return openDB<StudioSchema>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore("projects", { keyPath: "id" });
        const deployments = db.createObjectStore("deployments", { keyPath: ["chainId", "address"] });
        deployments.createIndex("projectId", "projectId");
        db.createObjectStore("trash", { keyPath: "id" });
        db.createObjectStore("meta");
      }
    },
    blocking(_current, newVersion) {
      options.onVersionChange(newVersion);
    },
  });
}

/** Meta keys. Viewports are per project, outside the document (spec L402, PA L14). */
export const META = {
  lastProject: "lastProject",
  explicitSave: "explicitSave",
  safariTip: "safariTipShown",
  viewport: (id: string) => `viewport:${id}`,
} as const;

/** Whether an error is the browser refusing a write for lack of space. */
export function isQuotaError(error: unknown): boolean {
  if (!(error instanceof DOMException) && !(error instanceof Error)) return false;
  return error.name === "QuotaExceededError" || (error instanceof DOMException && error.code === 22);
}
