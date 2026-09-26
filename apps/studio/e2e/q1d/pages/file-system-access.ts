/**
 * A fake File System Access API for Flow 10 steps 2 and 4 (spec L497-L499): Chromium exposes
 * `showSaveFilePicker`/`showOpenFilePicker` by default (confirmed in this build), but a real call opens a
 * native OS dialog Playwright has no locator for, so clicking Save or Open for real would hang the test. Both
 * helpers here replace the API via `context.addInitScript`, before the first navigation, so `file-io.ts` never
 * sees a difference between this and the real thing.
 */
import type { BrowserContext, Page } from "@playwright/test";

/**
 * Removes the File System Access API entirely, so Save a copy, ⌘S and Open fall back to a browser download and
 * the hidden `<input type=file>` — `file-io.ts`'s own fallback path, the same one Firefox and Safari take.
 * Install before the first `page.goto`.
 */
export async function disableFileSystemAccess(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    for (const name of ["showSaveFilePicker", "showOpenFilePicker", "showDirectoryPicker"]) {
      Object.defineProperty(window, name, { value: undefined, configurable: true });
    }
  });
}

const STORE = "__q1dFakeSaves";

/**
 * A working `showSaveFilePicker` that writes into an in-page object instead of disk, so Studio links the
 * project to it and a later ⌘S writes it directly ("Saved to {name}", spec L497). Install before the first
 * `page.goto`; read what it captured with `fakeSaveContents`.
 */
export async function stubSaveFilePicker(context: BrowserContext): Promise<void> {
  await context.addInitScript((store) => {
    const saved: Record<string, string> = {};
    (window as unknown as Record<string, unknown>)[store] = saved;
    type Writable = { write(data: string): Promise<void>; close(): Promise<void> };
    type Handle = { name: string; createWritable(): Promise<Writable> };
    (window as unknown as { showSaveFilePicker(options?: { suggestedName?: string }): Promise<Handle> }).showSaveFilePicker = async (
      options,
    ) => {
      const name = options?.suggestedName ?? "untitled.json";
      return {
        name,
        async createWritable() {
          return {
            async write(data: string) {
              saved[name] = data;
            },
            async close() {},
          };
        },
      };
    };
  }, STORE);
}

/** What `stubSaveFilePicker` captured for `name` (the exact text Studio wrote), or null if nothing has yet. */
export async function fakeSaveContents(page: Page, name: string): Promise<string | null> {
  return page.evaluate(
    ([store, n]) => (window as unknown as Record<string, Record<string, string> | undefined>)[store]?.[n] ?? null,
    [STORE, name] as const,
  );
}
