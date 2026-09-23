/**
 * Seeding a page before a flow starts. Nothing here clicks through the UI: settings go into localStorage before
 * the app's first script runs, and projects go into the app's IndexedDB database while the app isn't running, so
 * it opens them the way a returning visitor's last project opens (spec L401).
 *
 *   await openEmpty(page);                                         // a first visit: "Untitled", nothing placed
 *   await seedProject(page, { project: recipeProject("GovernedVault") });
 *   await seedProject(page, { project: collisionsProject() });     // 30 cards, SEL-01 collisions
 *   await seedProject(page, importedProject(projectFile()));       // records marked From file
 *   await page.goto(`/${shareLink(recipeProject("ERC20").recipe)}`);
 *
 * Store names follow S7a's `src/persist/db.ts` and S1's `src/state/settings-store.ts`.
 */
import { expect, type BrowserContext, type Page, type Route } from "@playwright/test";
import type { Deployment, Project } from "@lattice-studio/core";
import type { SettingsState } from "../../src/contracts/stores.ts";
import { DB_NAME, DB_VERSION, META } from "../../src/persist/db.ts";
import { SEEDED_AT } from "./projects.ts";

/** S1's settings key in localStorage. */
export const SETTINGS_KEY = "lattice-studio.settings.v1";
/** S7a's IndexedDB database, and its meta keys (`lastProject` names where a returning visitor lands). */
export { DB_NAME, META } from "../../src/persist/db.ts";

/** Settings to seed; `rpc` merges into what's stored instead of replacing it. */
export type SeedSettings = Partial<SettingsState>;

let settingsSeeds = 0;

/**
 * Writes `settings` into localStorage before the app's scripts run, once per tab (a reload keeps what the test
 * changed since). Call it before the first `page.goto`.
 */
export async function seedSettings(context: BrowserContext, settings: SeedSettings): Promise<void> {
  settingsSeeds += 1;
  await context.addInitScript(
    ({ key, marker, partial }) => {
      try {
        if (window.sessionStorage.getItem(marker) === "1") return;
        const raw = window.localStorage.getItem(key);
        const current = (raw ? JSON.parse(raw) : {}) as { rpc?: Record<string, string> };
        const next = { ...current, ...partial, rpc: { ...current.rpc, ...partial.rpc } };
        window.localStorage.setItem(key, JSON.stringify(next));
        window.sessionStorage.setItem(marker, "1");
      } catch {
        // about:blank and opaque origins have no storage; the app's own origin does.
      }
    },
    { key: SETTINGS_KEY, marker: `e2e-settings-seeded-${settingsSeeds}`, partial: settings },
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Waits until the app shows project `name`: `document.title` reads "{name} · {problems} · Lattice Studio"
 * (spec L780) at every layout tier.
 */
export async function expectProject(page: Page, name: string): Promise<void> {
  await expect(page).toHaveTitle(new RegExp(`^${escapeRegExp(name)} · .+ · Lattice Studio$`));
}

/** A first visit: opens the app with nothing stored and waits for the empty "Untitled" project. */
export async function openEmpty(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await expectProject(page, "Untitled");
}

export type SeededProject = { project: Project; deployments?: readonly Deployment[] };

/** A same-origin URL that runs none of the app's code: the page seeding writes from. */
export const QUIET_URL = "/catalog/manifest.json";

/**
 * Stores `project` (and its deployment records) as the last project, then opens the app so it lands there. The app
 * isn't running while the records are written (the page moves to `QUIET_URL` first), so nothing it autosaves on the
 * way out can overwrite them. Call it before the first `page.goto`, or from any page: it ends on `path`.
 */
export async function seedProject(page: Page, seeded: SeededProject, path = "/"): Promise<void> {
  await storeProject(page, seeded);
  await openHoldingCatalog(page, path, seeded.project.name);
}

/** The database version `storeProject` creates when there's none: S7a's first. */
export const SEEDED_DB_VERSION: number = 1;

/**
 * Writes `project` and its records into the app's database as the last project, from `QUIET_URL`, and leaves the page
 * there with the app not running. `seedProject` then opens the app; a test can inspect the database first.
 */
export async function storeProject(page: Page, seeded: SeededProject): Promise<void> {
  if (DB_VERSION !== SEEDED_DB_VERSION) {
    throw new Error(
      `S7a's database is at version ${DB_VERSION}, but seeding creates version ${SEEDED_DB_VERSION}'s stores. ` +
        "Update storeProject's upgrade in e2e/_support/seed.ts to match src/persist/db.ts.",
    );
  }
  await page.goto(QUIET_URL);
  await page.evaluate(
    async ({ dbName, lastKey, id, project, deployments, savedAt }) => {
      const settle = <T>(request: IDBRequest<T>): Promise<T> =>
        new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
        });
      const open = indexedDB.open(dbName);
      // No database yet: create version 1 exactly as S7a's `openStudioDb` upgrade does (src/persist/db.ts). The app
      // upgrades it from there like any visitor's. An existing database opens at its own version, unchanged.
      open.onupgradeneeded = (event) => {
        if (event.oldVersion !== 0) return;
        const db = open.result;
        db.createObjectStore("projects", { keyPath: "id" });
        db.createObjectStore("deployments", { keyPath: ["chainId", "address"] }).createIndex("projectId", "projectId");
        db.createObjectStore("trash", { keyPath: "id" });
        db.createObjectStore("meta");
      };
      const db = await settle(open);
      try {
        const tx = db.transaction(["projects", "deployments", "meta"], "readwrite");
        const done = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
          tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
        });
        tx.objectStore("projects").put({ id, savedAt, project });
        for (const deployment of deployments) tx.objectStore("deployments").put(deployment);
        tx.objectStore("meta").put(id, lastKey);
        await done;
      } finally {
        db.close();
      }
    },
    {
      dbName: DB_NAME,
      lastKey: META.lastProject,
      id: seeded.project.id,
      // Plain JSON, as IndexedDB would clone it (and Playwright's argument types stay shallow).
      project: JSON.parse(JSON.stringify(seeded.project)) as unknown,
      deployments: JSON.parse(JSON.stringify(seeded.deployments ?? [])) as unknown[],
      savedAt: SEEDED_AT,
    },
  );
}

/**
 * Opens `path` and waits for project `name`, holding the catalog manifest back until the app shows it. The app
 * pins its unsaved boot document to the catalog as soon as the catalog loads, and a boot document that changed
 * while storage was read keeps the visitor there instead of opening their last project (S1's `pinning.ts`, S7a's
 * `bootPersistence`). WebKit reads IndexedDB slower than the catalog arrives, so without the hold a seeded
 * project loses that race. Opening a project never needs the catalog, so the hold can't deadlock.
 */
async function openHoldingCatalog(page: Page, path: string, name: string): Promise<void> {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const hold = async (route: Route): Promise<void> => {
    await held;
    await route.fallback();
  };
  await page.route(`**${QUIET_URL}`, hold);
  try {
    await page.goto(path);
    await expectProject(page, name);
  } finally {
    release();
    await page.unroute(`**${QUIET_URL}`, hold);
  }
}
