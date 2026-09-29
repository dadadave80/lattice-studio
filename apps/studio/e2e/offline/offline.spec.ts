/**
 * Offline and repeat visits on the production build (spec L821, L830-L832): the service worker precaches the shell
 * and warms the detail shards of the facets on a sheet, so once it controls the page Studio reloads without a
 * network, keeps a placed facet's detail, and everything but chain actions works: composing, exports, files and
 * share links. Deploy is disabled with its reason.
 *
 * The suite lets the service worker run (`serviceWorkers: "allow"`), which the kit blocks everywhere else. That
 * weakens the network guard (requests the worker answers from its cache skip `page.route`), so each test asserts
 * on the network itself: a cache-busted request fails once `setOffline` is on. It never asks for `anvil`, whose
 * `stayOnline` would hide the offline state from the page. The CSP guard still runs: what the worker serves from
 * its cache must carry the same policy the host sent.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../_support/fixtures.ts";
import { region } from "../_support/keys.ts";
import { recipeProject, shareLink } from "../_support/projects.ts";
import { DB_NAME, META, openEmpty } from "../_support/seed.ts";

test.use({ serviceWorkers: "allow" });

/** The Offline line (spec L388), in the banner and the console's summary. */
const OFFLINE_LINE = "Offline. Composing works; deploy needs a connection.";
/** The worker's runtime cache for detail shards (`build/pwa.ts`'s `CATALOG_SHARDS_CACHE`). */
const SHARDS_CACHE = "lattice-catalog-shards";

/**
 * Waits until the service worker controls the page. With `clientsClaim` a worker takes control only once it has
 * activated, which is after its install finished precaching, so the shell is in the cache from here on.
 */
async function waitForControl(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 });
}

/** Whether a request past every cache (a fresh query string, `no-store`) reaches Studio's origin. */
async function networkAnswers(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    try {
      await fetch(`/catalog/manifest.json?offline-probe=${Date.now()}`, { cache: "no-store" });
      return true;
    } catch {
      return false;
    }
  });
}

/** Goes offline and proves it: the page says so and a request past the caches fails. */
async function goOffline(context: BrowserContext, page: Page): Promise<void> {
  await context.setOffline(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  expect(await networkAnswers(page), "a request past the caches fails").toBe(false);
}

/** The detail shard URLs the worker's runtime cache holds, by path. */
async function warmedShards(page: Page): Promise<string[]> {
  return page.evaluate(async (name) => {
    const cache = await caches.open(name);
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  }, SHARDS_CACHE);
}

/** Opens the app on a first visit and waits for the worker to control it with the sheet loaded. */
async function openControlled(page: Page): Promise<void> {
  await openEmpty(page);
  await waitForControl(page);
  await expect(region(page, "Sheet").getByRole("toolbar", { name: "Sheet tools" })).toBeVisible();
}

/** Places `facet` through the console's command line. */
async function place(page: Page, facet: string): Promise<void> {
  const line = region(page, "Console").getByRole("textbox", { name: "Command line" });
  await line.fill(`place ${facet.toLowerCase()}`);
  await line.press("Enter");
  await expect(region(page, "Sheet").getByRole("group", { name: new RegExp(`^${facet}(,|$)`) })).toBeVisible();
}

/**
 * Waits until autosave (750 ms after the last edit, `src/persist/persistence.ts`) has stored the last project with
 * `facet` on it, so a reload lands there (spec L401) instead of racing the write.
 */
async function waitForAutosave(page: Page, facet: string): Promise<void> {
  const stored = () =>
    page.evaluate(
      async ({ dbName, lastKey }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const open = indexedDB.open(dbName);
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error ?? new Error("IndexedDB didn't open."));
        });
        try {
          const read = <T,>(store: string, key: IDBValidKey) =>
            new Promise<T | undefined>((resolve, reject) => {
              const request = db.transaction(store).objectStore(store).get(key);
              request.onsuccess = () => resolve(request.result as T | undefined);
              request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed."));
            });
          const id = await read<string>("meta", lastKey);
          if (id === undefined) return [];
          const row = await read<{ project: { recipe: { facets: string[] } } }>("projects", id);
          return row?.project.recipe.facets ?? [];
        } finally {
          db.close();
        }
      },
      { dbName: DB_NAME, lastKey: META.lastProject },
    );
  await expect.poll(stored, { message: `autosave stores the project with ` }).toContain(facet);
}

/** Without the File System Access API, saving a file is a browser download (Firefox and Safari's path). */
async function saveThroughDownloads(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    for (const name of ["showSaveFilePicker", "showOpenFilePicker", "showDirectoryPicker"]) {
      Object.defineProperty(window, name, { value: undefined, configurable: true });
    }
  });
}

test.describe("Offline (spec L830-L832)", () => {
  test("a repeat visit loads from the service worker with no network", async ({ page, context }) => {
    await openControlled(page);
    await goOffline(context, page);

    await page.reload();
    await expect(page).toHaveTitle(/^Untitled · .+ · Lattice Studio$/);
    await expect(region(page, "Sheet").getByRole("toolbar", { name: "Sheet tools" })).toBeVisible();
    await expect(page.getByText(OFFLINE_LINE).first()).toBeVisible();
    expect(await networkAnswers(page), "still offline after the reload").toBe(false);
  });

  test("a facet whose shard was warmed keeps its detail offline; one never placed doesn't", async ({ page, context }) => {
    await openControlled(page);
    await place(page, "ERC20");
    await expect.poll(() => warmedShards(page), { message: "placing ERC20 warms its shard" }).toContainEqual(
      expect.stringMatching(/\/shards\/ERC20\.json$/),
    );
    const erc20 = (await warmedShards(page)).find((path) => path.endsWith("/shards/ERC20.json")) ?? "";
    const cold = erc20.replace(/ERC20\.json$/, "AccessControl.json");
    expect(await warmedShards(page)).not.toContain(cold);
    await waitForAutosave(page, "ERC20");

    await goOffline(context, page);
    await page.reload();
    await expect(region(page, "Sheet").getByRole("group", { name: /^ERC20(,|$)/ })).toBeVisible();

    const status = (path: string) =>
      page.evaluate(async (url) => {
        try {
          return (await fetch(url)).status;
        } catch {
          return 0;
        }
      }, path);
    expect(await status(erc20), "the warmed shard answers from the cache").toBe(200);
    expect(await status(cold), "a shard never warmed can't load offline").toBe(0);

    // Composing still works: a facet whose shard never warmed places from the precached catalog index.
    await place(page, "ERC20Burnable");
  });

  test("offline, exports, saving a file and opening a share link all work; Deploy says why it can't", async ({ page, context }) => {
    await saveThroughDownloads(context);
    await openControlled(page);
    await place(page, "ERC20");
    await waitForAutosave(page, "ERC20");
    await goOffline(context, page);
    await page.reload();
    await expect(region(page, "Sheet").getByRole("group", { name: /^ERC20(,|$)/ })).toBeVisible();

    // Deploy is disabled with its reason (spec L388, L561).
    const deploy = region(page, "Sheet").getByRole("button", { name: "Deploy…", exact: true });
    await expect(deploy).toHaveAttribute("aria-disabled", "true");
    await expect(deploy).toHaveAccessibleDescription("Deploy needs a connection");

    // An export: the agent brief downloads.
    const console_ = region(page, "Console");
    await console_.getByRole("button", { name: "Export", exact: true }).click();
    const menu = page.getByRole("menu", { name: "Export" });
    const [brief] = await Promise.all([
      page.waitForEvent("download"),
      menu.getByRole("menuitem", { name: "Agent brief", exact: true }).click(),
    ]);
    expect(brief.suggestedFilename()).toMatch(/\.brief\.md$/);

    // A file: Save a copy downloads the project file.
    await console_.getByRole("button", { name: "Export", exact: true }).click();
    await menu.getByRole("menuitem", { name: "Project file", exact: true }).click();
    const saveCopy = page.getByRole("dialog", { name: "Save a copy" });
    await expect(saveCopy).toBeVisible();
    const [file] = await Promise.all([page.waitForEvent("download"), saveCopy.getByRole("button", { name: "Save" }).click()]);
    expect(file.suggestedFilename()).toMatch(/\.lattice\.json$/);

    // A share link, in a new tab the worker serves.
    // GovernedVault, not the ERC20 project this tab would land in without the link.
    const recipe = recipeProject("GovernedVault").recipe;
    const tab = await context.newPage();
    await tab.goto(`/${shareLink(recipe)}`);
    await expect(region(tab, "Sheet").getByRole("group", { name: /^ERC4626(,|$)/ })).toBeVisible();
    expect(await networkAnswers(tab), "the tab opened with no network").toBe(false);
    await tab.close();
  });
});
