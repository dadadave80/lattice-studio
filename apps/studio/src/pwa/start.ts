/**
 * The lazy half of the PWA module, loaded right after the app starts (`boot.ts`): registers the service worker
 * (production builds only; the dev server has none), runs the update prompt and warms the catalog shards.
 */
import { Workbox } from "workbox-window";
import {
  doc, getCatalogStatus, hideBanner, loadFacetDetail, log, saveStatus, showBanner, subscribeCatalog, subscribeSaveStatus,
  type CatalogStatus,
} from "@/contracts";
import type { Connection } from "./connection";
import { pwaState } from "./state";
import { createUpdates, type WorkboxLike } from "./updates";
import { warmShards } from "./warm";

/** The worker and its scope, under the app's base (`/` on Vercel, `./` on IPFS). */
export function serviceWorkerUrl(base: string = import.meta.env.BASE_URL): { url: string; scope: string } {
  return { url: `${base}sw.js`, scope: base };
}

/** The catalog's status as `afterCatalogLine` reads it; tests pass their own. */
export type CatalogFeed = {
  get: () => CatalogStatus;
  subscribe: (listener: (status: CatalogStatus) => void) => () => void;
};

const catalogFeed: CatalogFeed = { get: getCatalogStatus, subscribe: subscribeCatalog };

/**
 * Runs `run` once the catalog line has been logged, so nothing comes before it in the console (spec L401): at
 * once when the catalog has already loaded or failed, else when it does. The loader logs its line right after it
 * publishes "ready", so `run` waits one microtask past the change. Returns a disposer that drops a pending run.
 */
export function afterCatalogLine(run: () => void, catalog: CatalogFeed = catalogFeed): () => void {
  if (catalog.get().status !== "loading") {
    run();
    return () => {};
  }
  let live = true;
  const stop = catalog.subscribe((status) => {
    if (status.status === "loading") return;
    stop();
    queueMicrotask(() => {
      if (live) run();
    });
  });
  return () => {
    live = false;
    stop();
  };
}

function registerWorker(connection: Connection): () => void {
  const container = navigator.serviceWorker;
  const { url, scope } = serviceWorkerUrl();
  const workbox = new Workbox(url, { scope });
  const updates = createUpdates({
    workbox: workbox as unknown as WorkboxLike,
    saveStatus,
    subscribeSaveStatus,
    chunkFailed: pwaState.chunkFailed,
    subscribeChunkFailed: pwaState.subscribe,
    showBanner,
    hideBanner,
    reloadPage: pwaState.reloadPage,
    reportFailure: connection.reportFailure,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (handle) => window.clearInterval(handle as number),
  });
  pwaState.setUpdates(updates);
  let stopNote = () => {};
  workbox.register().catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    const text = `Studio can't work offline in this browser: its service worker didn't register (${reason}).`;
    stopNote = afterCatalogLine(() => log({ tag: "Note", text }));
  });
  const stopWarm = warmShards({
    facets: () => doc.get().recipe.facets,
    subscribeDocument: (listener) => doc.subscribe(listener),
    catalogId: () => {
      const status = getCatalogStatus();
      return status.status === "ready" ? status.id : null;
    },
    subscribeCatalog: (listener) => subscribeCatalog(listener),
    load: loadFacetDetail,
    controlled: () => container.controller !== null,
    subscribeControl: (listener) => {
      container.addEventListener("controllerchange", listener);
      return () => container.removeEventListener("controllerchange", listener);
    },
    reportFailure: connection.reportFailure,
  });
  return () => {
    stopNote();
    stopWarm();
    updates.dispose();
    pwaState.setUpdates(null);
  };
}

/** Starts the service worker side; returns a disposer. */
export function startPwa(connection: Connection): () => void {
  if (!import.meta.env.PROD || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => {};
  return registerWorker(connection);
}
