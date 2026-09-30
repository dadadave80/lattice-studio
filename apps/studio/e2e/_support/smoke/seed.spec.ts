/**
 * Seeding: an empty first visit, a recipe, 30 cards with collisions, a project file's From file records, a share
 * link and settings, each checked against what the shell shows.
 */
import { CORE_FACETS, decodeShareLink, isCoreFacet, parseProjectFile, type Project } from "@lattice-studio/core";
import type { Page } from "@playwright/test";
import { catalog } from "../catalog.ts";
import { expect, test } from "../fixtures.ts";
import { region } from "../keys.ts";
import {
  collisionsProject, deploymentFor, filePayload, importedProject, projectFile, recipeProject, shareLink,
} from "../projects.ts";
import { DB_VERSION } from "../../../src/persist/db.ts";
import {
  DB_NAME, QUIET_URL, SEEDED_DB_VERSION, SETTINGS_KEY, openEmpty, seedProject, seedSettings, storeProject,
} from "../seed.ts";

/**
 * The catalog's "n on sheet" counts, summed over its area folders: how many facets the recipe holds, the core's
 * two (DiamondLoupeFacet, ERC165Facet, in the Diamond area) included.
 */
async function catalogOnSheet(page: Page): Promise<number> {
  const counts = await region(page, "Left pane").getByText(/^\d+ on sheet$/).allTextContents();
  return counts.reduce((sum, text) => sum + Number.parseInt(text, 10), 0);
}

/** The cards on the sheet: each is a group named for its selectors ("ERC20, 9 selectors"). */
function sheetCards(page: Page) {
  return region(page, "Sheet").getByRole("group", { name: / \d+ selectors?/ });
}

/** A project's cards: its recipe's facets minus the core's two, which are never on the sheet. */
function cards(project: Project): number {
  return project.recipe.facets.filter((name) => !isCoreFacet(name)).length;
}

/** Deployment records stored for `projectId`, read back from the app's database. */
async function storedRecords(page: Page, projectId: string): Promise<{ fromFile?: boolean }[]> {
  return page.evaluate(
    async ({ dbName, id }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const all = await new Promise<{ projectId: string; fromFile?: boolean }[]>((resolve, reject) => {
        const request = db.transaction("deployments").objectStore("deployments").getAll();
        request.onsuccess = () => resolve(request.result as { projectId: string; fromFile?: boolean }[]);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return all.filter((d) => d.projectId === id);
    },
    { dbName: DB_NAME, id: projectId },
  );
}

/** The app's database layout: version, stores, key paths and indexes. */
async function databaseLayout(page: Page): Promise<unknown> {
  return page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const names = [...db.objectStoreNames].sort();
    const tx = db.transaction(names);
    const stores = names.map((name) => {
      const store = tx.objectStore(name);
      return { name, keyPath: store.keyPath, indexes: [...store.indexNames].map((i) => [i, store.index(i).keyPath]) };
    });
    const layout = { version: db.version, stores };
    db.close();
    return layout;
  }, DB_NAME);
}

test.describe("seeding @smoke", () => {
  test("creates the database exactly as the app does", async ({ page }) => {
    expect(DB_VERSION, "seeding creates S7a's version-1 stores").toBe(SEEDED_DB_VERSION);
    await openEmpty(page);
    const byApp = await databaseLayout(page);
    // Away from the app (its connection closes), delete what it made, and let seeding create the database.
    await page.goto(QUIET_URL);
    await page.evaluate(
      (dbName) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(dbName);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error("The app still holds the database open."));
        }),
      DB_NAME,
    );
    await storeProject(page, { project: recipeProject("ERC20") });
    // Read before the app loads, so its upgrade can't paper over a difference.
    expect(page.url()).toContain(QUIET_URL);
    expect(await databaseLayout(page)).toEqual(byApp);
  });

  test("empty: a first visit opens Untitled with no cards on the sheet", async ({ page }) => {
    await openEmpty(page);
    await expect(region(page, "Title bar").getByRole("button", { name: "Untitled", exact: true })).toBeVisible();
    await expect(sheetCards(page)).toHaveCount(0);
    // The untitled recipe is core-only: the catalog counts the core's two facets, and no card shows.
    await expect.poll(() => catalogOnSheet(page)).toBe(CORE_FACETS.length);
  });

  test("a recipe opens as the last project, editable", async ({ page }) => {
    const project = recipeProject("GovernedVault");
    await seedProject(page, { project });
    await expect(region(page, "Title bar").getByRole("button", { name: "GovernedVault", exact: true })).toBeVisible();
    await expect.poll(() => catalogOnSheet(page)).toBe(project.recipe.facets.length);
    await expect(sheetCards(page)).toHaveCount(cards(project));
    await expect(region(page, "Title bar").getByText("Read-only")).toHaveCount(0);
  });

  test("30 cards with collisions", async ({ page }) => {
    const project = collisionsProject();
    // 30 facets, two of them the core: 28 cards, so 28 layout entries and 28 on the sheet; the catalog counts 30.
    expect(project.recipe.facets).toHaveLength(30);
    expect(Object.keys(project.layout)).toHaveLength(cards(project));
    await seedProject(page, { project });
    await expect.poll(() => catalogOnSheet(page)).toBe(project.recipe.facets.length);
    await expect(sheetCards(page)).toHaveCount(cards(project));
    await expect(page).toHaveTitle(/^30 cards · \d+ blockers?/);
  });

  test("a project file with From file records", async ({ page }) => {
    const file = projectFile();
    expect(file.filename).toMatch(/\.lattice\.json$/);
    const parsed = parseProjectFile(JSON.parse(file.text), { catalogs: [catalog()], source: "file" });
    expect(parsed.ok).toBe(true);
    expect(filePayload(file).buffer.toString("utf8")).toBe(file.text);

    const imported = importedProject(file);
    expect(imported.deployments.length).toBeGreaterThan(0);
    expect(imported.deployments.every((d) => d.fromFile === true)).toBe(true);
    expect(Object.values(imported.project.provenance)).toContain("file");

    await seedProject(page, imported);
    const records = await storedRecords(page, imported.project.id);
    expect(records).toHaveLength(imported.deployments.length);
    expect(records.every((d) => d.fromFile === true)).toBe(true);
  });

  test("a share link opens without errors", async ({ page }) => {
    const recipe = recipeProject("ERC20").recipe;
    const link = shareLink(recipe);
    expect(link).toMatch(/^#s=1\./);
    const decoded = decodeShareLink(link, [catalog()]);
    expect(decoded.ok && decoded.value.recipe.facets).toEqual(recipe.facets);

    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/${link}`);
    await expect(page).toHaveTitle(/ · Lattice Studio$/);
    await expect(region(page, "Title bar")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("settings reach the app before its first script", async ({ page, context }) => {
    await seedSettings(context, { theme: "light", rpc: { 31337: "http://127.0.0.1:1" } });
    await openEmpty(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as { rpc?: Record<string, string> }, SETTINGS_KEY);
    expect(stored.rpc?.["31337"]).toBe("http://127.0.0.1:1");
  });

  for (const [saved, theme] of [["shop", "dark"], ["draft", "light"]] as const) {
    test(`a theme saved as "${saved}" before the rename opens in the ${theme} theme`, async ({ page, context }) => {
      await context.addInitScript(
        ({ key, value }) => window.localStorage.setItem(key, JSON.stringify({ theme: value })),
        { key: SETTINGS_KEY, value: saved },
      );
      // The system prefers the other theme, so falling back to System would show the wrong one.
      await page.emulateMedia({ colorScheme: theme === "dark" ? "light" : "dark" });
      await openEmpty(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    });
  }

  test("records name the address core predicts", () => {
    const project = recipeProject("ERC20", { filled: true });
    const record = deploymentFor(project);
    expect(record.projectId).toBe(project.id);
    expect(record.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(deploymentFor(project)).toEqual(record);
  });
});
