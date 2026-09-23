import { describe, expect, test, vi } from "vitest";
import { provideServices, type ConnectionService } from "@/contracts";
import { bufferedServices, onCleanup } from "../../test/harness";
import { bootPwa } from "./boot";
import { isChunkLoadError, watchChunkErrors } from "./chunk-errors";
import { createConnection, type Connection } from "./connection";
import { BANNERS } from "./copy";
import { isolatePwaState, pwaState } from "./state";

/** A connection the test switches by hand, provided as the app's. */
function switchableConnection(online: boolean): ConnectionService & { set(online: boolean): void } {
  let current = online;
  const listeners = new Set<(online: boolean) => void>();
  const service = {
    isOnline: () => current,
    subscribe(listener: (online: boolean) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set(next: boolean) {
      current = next;
      for (const fn of Array.from(listeners)) fn(next);
    },
  };
  onCleanup(provideServices({ connection: service }));
  return service;
}

function inertConnection(): Connection {
  return createConnection({
    target: new EventTarget(),
    onLine: () => true,
    probe: async () => true,
    setTimeout: () => 0,
    clearTimeout: () => {},
  });
}

function boot(load: () => Promise<{ startPwa(connection: Connection): () => void }> = () => new Promise(() => {})) {
  const target = new EventTarget();
  onCleanup(isolatePwaState(vi.fn()));
  const stop = bootPwa(inertConnection(), { target, load });
  onCleanup(stop);
  return { target, stop };
}

const preloadError = (payload: unknown) => Object.assign(new Event("vite:preloadError"), { payload });

describe("the Offline banner", () => {
  test('shows "Offline. Composing works; deploy needs a connection." while offline and clears itself', () => {
    const connection = switchableConnection(true);
    boot();
    expect(bufferedServices().banners.has(BANNERS.offline.id)).toBe(false);
    connection.set(false);
    expect(bufferedServices().banners.get(BANNERS.offline.id)).toEqual({
      text: "Offline. Composing works; deploy needs a connection.",
      tone: "warning",
    });
    connection.set(true);
    expect(bufferedServices().banners.has(BANNERS.offline.id)).toBe(false);
  });

  test("shows at once when the app starts offline, with no action to take", () => {
    switchableConnection(false);
    boot();
    const banner = bufferedServices().banners.get(BANNERS.offline.id);
    expect(banner?.actions).toBeUndefined();
    expect(banner?.dismissible).toBeUndefined();
  });

  test("goes away when the module stops", () => {
    switchableConnection(false);
    const { stop } = boot();
    stop();
    expect(bufferedServices().banners.has(BANNERS.offline.id)).toBe(false);
  });
});

describe("chunk-load failures", () => {
  test('a failed chunk shows "Studio was updated. Save and reload to continue." with Save and reload', () => {
    switchableConnection(true);
    const { target } = boot();
    target.dispatchEvent(preloadError(new TypeError("Failed to fetch dynamically imported module: /assets/Deploy-abc.js")));
    expect(bufferedServices().banners.get(BANNERS.updated.id)).toEqual({
      text: "Studio was updated. Save and reload to continue.",
      tone: "warning",
      actions: [{ id: "app.saveAndReload" }],
    });
    expect(pwaState.chunkFailed()).toBe(true);
    expect(bufferedServices().log.at(-1)).toMatchObject({
      tag: "Error",
      text: "Couldn't load part of Studio: Failed to fetch dynamically imported module: /assets/Deploy-abc.js",
    });
  });

  test("an uncaught failed import() counts too; other rejections don't", () => {
    switchableConnection(true);
    const { target } = boot();
    const reject = (reason: unknown) => {
      const event = Object.assign(new Event("unhandledrejection"), { reason });
      target.dispatchEvent(event);
    };
    reject(new Error("Something else broke"));
    expect(bufferedServices().banners.has(BANNERS.updated.id)).toBe(false);
    reject(new TypeError("Importing a module script failed."));
    expect(bufferedServices().banners.has(BANNERS.updated.id)).toBe(true);
  });

  test("failing to load the module's own lazy half is a chunk failure", async () => {
    switchableConnection(true);
    boot(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module: /assets/start-1.js")));
    await vi.waitFor(() => expect(bufferedServices().banners.has(BANNERS.updated.id)).toBe(true));
  });

  test("the lazy half starts with the app's connection", async () => {
    switchableConnection(true);
    const startPwa = vi.fn(() => () => {});
    boot(async () => ({ startPwa }));
    await vi.waitFor(() => expect(startPwa).toHaveBeenCalledTimes(1));
  });

  test("recognizes each browser's message and vite-plugin-sri-gen's", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://x/assets/a.js",
      "error loading dynamically imported module: https://x/assets/a.js",
      "Importing a module script failed.",
      "[vite-plugin-sri-gen] Integrity verification failed for https://x/assets/a.js",
    ]) {
      expect(isChunkLoadError(new TypeError(message))).toBe(true);
    }
    expect(isChunkLoadError(new Error("Couldn't read Sepolia"))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });

  test("watchChunkErrors stops when disposed", () => {
    const target = new EventTarget();
    const seen = vi.fn();
    const stop = watchChunkErrors(target, seen);
    target.dispatchEvent(preloadError(new Error("x")));
    stop();
    target.dispatchEvent(preloadError(new Error("y")));
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
