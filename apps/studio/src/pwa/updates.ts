/**
 * Updates that never lose work (spec L830-L831). With `registerType: 'prompt'` a new service worker waits
 * instead of taking over; this tab keeps running its own build from the precache. "A new version of Studio
 * is ready." shows only while the project is saved (or the tab is read-only, with nothing of its own to
 * save), and hides again while a save is pending. Its **Reload** activates the waiting worker and reloads once
 * it controls the page. After a chunk failed to load, "Studio was updated. Save and reload to continue."
 * takes its place.
 */
import type { BannerProps, SaveStatus } from "@/contracts";
import { BANNERS } from "./copy";

/** The part of workbox-window's `Workbox` this uses; tests pass a fake. */
export type WorkboxLike = {
  addEventListener(type: "waiting" | "controlling", listener: (event: { isExternal?: boolean }) => void): void;
  removeEventListener(type: "waiting" | "controlling", listener: (event: { isExternal?: boolean }) => void): void;
  messageSkipWaiting(): void;
  update(): Promise<unknown>;
};

export type UpdateDeps = {
  workbox: WorkboxLike;
  saveStatus(): SaveStatus;
  subscribeSaveStatus(listener: (status: SaveStatus) => void): () => void;
  chunkFailed(): boolean;
  subscribeChunkFailed(listener: () => void): () => void;
  showBanner(id: string, props: BannerProps): void;
  hideBanner(id: string): void;
  reloadPage(): void;
  /** An update check failed: maybe the network is gone. */
  reportFailure?(): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  /** How often a long-lived tab asks for a new version. Default 1 h. */
  checkEveryMs?: number;
  /** How long Reload waits for the new worker to take over before reloading anyway. Default 3 s. */
  activateTimeoutMs?: number;
};

export type Updates = {
  /** Whether a new version is waiting or already took over another tab. */
  ready(): boolean;
  /** Activates the waiting worker, if any, then reloads. */
  reload(): Promise<void>;
  dispose(): void;
};

/** Nothing of this tab's would be lost by reloading now. */
export function safeToReload(status: SaveStatus): boolean {
  return status.state === "saved" || status.state === "read-only";
}

export function createUpdates(deps: UpdateDeps): Updates {
  let ready = false;
  let waiting = false;
  let shown: "update" | "updated" | null = null;

  const sync = () => {
    const next = deps.chunkFailed() ? "updated" : ready && safeToReload(deps.saveStatus()) ? "update" : null;
    if (next === shown) return;
    if (shown === "update") deps.hideBanner(BANNERS.update.id);
    if (next === "update") {
      deps.showBanner(BANNERS.update.id, { text: BANNERS.update.text, tone: "info", actions: [{ id: "app.reload" }] });
    }
    // The chunk-failure banner is shown where the failure is caught (entry chunk); here it only displaces this one.
    shown = next;
  };

  const onWaiting = () => {
    ready = true;
    waiting = true;
    sync();
  };
  const onControlling = (event: { isExternal?: boolean }) => {
    // Another tab took the update: this one still runs the old build, and a reload gets the new one.
    if (event.isExternal) {
      ready = true;
      waiting = false;
      sync();
    }
  };
  deps.workbox.addEventListener("waiting", onWaiting);
  deps.workbox.addEventListener("controlling", onControlling);
  const stopSave = deps.subscribeSaveStatus(sync);
  const stopChunk = deps.subscribeChunkFailed(sync);
  const check = () => {
    deps.workbox.update().catch(() => deps.reportFailure?.());
  };
  const interval = deps.setInterval(check, deps.checkEveryMs ?? 60 * 60 * 1000);

  return {
    ready: () => ready,
    reload() {
      if (!waiting) {
        deps.reloadPage();
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        let done = false;
        let timer: unknown = null;
        const go = () => {
          if (done) return;
          done = true;
          if (timer !== null) deps.clearTimeout(timer);
          deps.workbox.removeEventListener("controlling", go);
          deps.reloadPage();
          resolve();
        };
        deps.workbox.addEventListener("controlling", go);
        timer = deps.setTimeout(go, deps.activateTimeoutMs ?? 3000);
        deps.workbox.messageSkipWaiting();
      });
    },
    dispose() {
      deps.workbox.removeEventListener("waiting", onWaiting);
      deps.workbox.removeEventListener("controlling", onControlling);
      stopSave();
      stopChunk();
      deps.clearInterval(interval);
      if (shown === "update") deps.hideBanner(BANNERS.update.id);
      shown = null;
    },
  };
}
