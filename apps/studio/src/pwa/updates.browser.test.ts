import { describe, expect, test, vi } from "vitest";
import type { BannerProps } from "@/contracts";
import { BANNERS } from "./copy";
import { safeToReload } from "./saved";
import { createUpdates, type UpdateDeps } from "./updates";
import {
  fakeSaveStatus, fakeWorkbox, manualTimers, READ_ONLY, SAVED, SAVING, STORAGE_FULL, type FakeWorkbox,
} from "./test-support";

function setup(initial = SAVED) {
  const workbox: FakeWorkbox = fakeWorkbox();
  const save = fakeSaveStatus(initial);
  const timers = manualTimers();
  const banners = new Map<string, BannerProps>();
  let chunkFailed = false;
  const chunkListeners = new Set<() => void>();
  const reloadPage = vi.fn();
  const reportFailure = vi.fn();
  const deps: UpdateDeps = {
    workbox,
    saveStatus: save.get,
    subscribeSaveStatus: save.subscribe,
    chunkFailed: () => chunkFailed,
    subscribeChunkFailed: (fn) => {
      chunkListeners.add(fn);
      return () => void chunkListeners.delete(fn);
    },
    showBanner: (id, props) => void banners.set(id, props),
    hideBanner: (id) => void banners.delete(id),
    reloadPage,
    reportFailure,
    ...timers,
  };
  const updates = createUpdates(deps);
  const failChunk = () => {
    chunkFailed = true;
    for (const fn of chunkListeners) fn();
  };
  return { workbox, save, timers, banners, reloadPage, reportFailure, updates, failChunk };
}

describe("the update banner", () => {
  test("stays hidden until a new version is waiting", () => {
    const { banners, updates } = setup();
    expect(banners.size).toBe(0);
    expect(updates.ready()).toBe(false);
  });

  test('shows "A new version of Studio is ready." with Reload once an update waits and the project is saved', () => {
    const { workbox, banners, updates } = setup(SAVED);
    workbox.emitWaiting();
    expect(updates.ready()).toBe(true);
    expect(banners.get(BANNERS.update.id)).toEqual({
      text: "A new version of Studio is ready.",
      tone: "info",
      actions: [{ id: "app.reload" }],
    });
  });

  test("waits while the project isn't saved, and shows once it is", () => {
    const { workbox, save, banners } = setup(SAVING);
    workbox.emitWaiting();
    expect(banners.has(BANNERS.update.id)).toBe(false);
    save.set(SAVED);
    expect(banners.has(BANNERS.update.id)).toBe(true);
  });

  test("once shown, stays up through autosaves: no flicker, and focus stays on Reload", () => {
    const { workbox, save, banners } = setup(SAVED);
    const shown: string[] = [];
    workbox.emitWaiting();
    shown.push(banners.has(BANNERS.update.id) ? "shown" : "hidden");
    for (const status of [SAVING, SAVED, SAVING, SAVED]) {
      save.set(status);
      shown.push(banners.has(BANNERS.update.id) ? "shown" : "hidden");
    }
    expect(shown).toEqual(["shown", "shown", "shown", "shown", "shown"]);
  });

  test("never shows while the project can't be saved", () => {
    const { workbox, banners } = setup(STORAGE_FULL);
    workbox.emitWaiting();
    expect(banners.size).toBe(0);
  });

  test("shows in a read-only tab, which has nothing of its own to save", () => {
    const { workbox, banners } = setup(READ_ONLY);
    workbox.emitWaiting();
    expect(banners.has(BANNERS.update.id)).toBe(true);
    expect(safeToReload(READ_ONLY)).toBe(true);
  });

  test("steps aside for the chunk-failure banner", () => {
    const { workbox, banners, failChunk } = setup(SAVED);
    workbox.emitWaiting();
    failChunk();
    expect(banners.has(BANNERS.update.id)).toBe(false);
  });

  test("shows when another tab took the update: this tab still runs the old build", () => {
    const { workbox, banners, updates } = setup(SAVED);
    workbox.emitControlling(true);
    expect(updates.ready()).toBe(true);
    expect(banners.has(BANNERS.update.id)).toBe(true);
  });

  test("ignores this tab's own first install", () => {
    const { workbox, banners, updates } = setup(SAVED);
    workbox.emitControlling(false);
    expect(updates.ready()).toBe(false);
    expect(banners.size).toBe(0);
  });

  test("dispose hides it and stops listening", () => {
    const { workbox, banners, updates, save, timers } = setup(SAVED);
    workbox.emitWaiting();
    updates.dispose();
    expect(banners.size).toBe(0);
    save.set(SAVING);
    save.set(SAVED);
    workbox.emitWaiting();
    expect(banners.size).toBe(0);
    expect(timers.pending()).toBe(0);
  });
});

describe("reload", () => {
  test("activates the waiting worker and reloads once it controls the page", async () => {
    const { workbox, reloadPage, updates } = setup(SAVED);
    workbox.emitWaiting();
    const done = updates.reload();
    expect(workbox.skipWaitingCalls).toBe(1);
    expect(reloadPage).not.toHaveBeenCalled();
    workbox.emitControlling(false);
    expect(await done).toBe(true);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  test("an edit made while the new worker takes over is saved before the page reloads", async () => {
    const { workbox, save, reloadPage, updates } = setup(SAVED);
    workbox.emitWaiting();
    const done = updates.reload();
    save.set(SAVING);
    workbox.emitControlling(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reloadPage).not.toHaveBeenCalled();
    save.set(SAVED);
    expect(await done).toBe(true);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  test("doesn't reload when that save fails", async () => {
    const { workbox, save, reloadPage, updates } = setup(SAVED);
    workbox.emitWaiting();
    const done = updates.reload();
    save.set(SAVING);
    workbox.emitControlling(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    save.set(STORAGE_FULL);
    expect(await done).toBe(false);
    expect(reloadPage).not.toHaveBeenCalled();
  });

  test("reloads anyway if the new worker hasn't taken over in 3 s, and only once", async () => {
    const { workbox, reloadPage, updates, timers } = setup(SAVED);
    workbox.emitWaiting();
    const done = updates.reload();
    timers.advance(2999);
    expect(reloadPage).not.toHaveBeenCalled();
    timers.advance(1);
    expect(await done).toBe(true);
    workbox.emitControlling(false);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  test("gives up without reloading when a save is still running after 10 s", async () => {
    const { workbox, save, reloadPage, updates, timers } = setup(SAVED);
    workbox.emitWaiting();
    const done = updates.reload();
    save.set(SAVING);
    workbox.emitControlling(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    timers.advance(10_000);
    expect(await done).toBe(false);
    expect(reloadPage).not.toHaveBeenCalled();
  });

  test("just reloads when nothing is waiting", async () => {
    const { workbox, reloadPage, updates } = setup(SAVED);
    expect(await updates.reload()).toBe(true);
    expect(workbox.skipWaitingCalls).toBe(0);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });
});

describe("update checks", () => {
  test("a long-lived tab asks for a new version every hour", () => {
    const { workbox, timers } = setup();
    timers.advance(60 * 60 * 1000 - 1);
    expect(workbox.updateCalls).toBe(0);
    timers.advance(1);
    timers.advance(60 * 60 * 1000);
    expect(workbox.updateCalls).toBe(2);
  });

  test("a failed check asks the connection to probe", async () => {
    const { workbox, timers, reportFailure } = setup();
    workbox.failUpdate = true;
    timers.advance(60 * 60 * 1000);
    await vi.waitFor(() => expect(reportFailure).toHaveBeenCalledTimes(1));
  });
});
