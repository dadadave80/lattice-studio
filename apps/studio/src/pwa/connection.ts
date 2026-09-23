/**
 * The app's connection state (contracts §5.2 `connection`, spec L832): offline when the browser says so, and
 * also when it claims to be online but Studio's own origin doesn't answer (a captive portal, a dropped
 * link). A failed fetch doesn't mean offline by itself (one RPC can be down while the network is fine), so a
 * reported failure triggers a probe of Studio's origin, and only an unanswered probe goes offline. While
 * offline that way it probes again every `retryMs`, and whenever the tab becomes visible or the browser says
 * it's back.
 *
 * No probe runs at creation: `services.ts` builds this at module evaluation, where fetches aren't allowed.
 */
import type { ConnectionService } from "@/contracts";

export type ConnectionDeps = {
  /** Where `online` and `offline` fire (the window). */
  target: EventTarget;
  /** Where `visibilitychange` fires, and whether the tab shows (the document). */
  page?: EventTarget & { readonly visibilityState: DocumentVisibilityState };
  /** `navigator.onLine`. */
  onLine(): boolean;
  /** Resolves true when Studio's origin answers at all, false when the request fails. */
  probe(): Promise<boolean>;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** How long to wait before probing again while unreachable. Default 15 s. */
  retryMs?: number;
};

export type Connection = ConnectionService & {
  /** A request failed in a way that could mean the network is gone: probe Studio's origin. */
  reportFailure(): void;
  /** Removes the listeners and any pending probe. */
  dispose(): void;
};

export function createConnection(deps: ConnectionDeps): Connection {
  const retryMs = deps.retryMs ?? 15_000;
  const listeners = new Set<(online: boolean) => void>();
  let browserOnline = deps.onLine();
  let reachable = true;
  let probing = false;
  let retry: unknown = null;
  let last = browserOnline && reachable;

  const current = () => browserOnline && reachable;
  const emit = () => {
    const now = current();
    if (now === last) return;
    last = now;
    for (const listener of Array.from(listeners)) listener(now);
  };
  const cancelRetry = () => {
    if (retry !== null) deps.clearTimeout(retry);
    retry = null;
  };
  const check = () => {
    if (probing || !browserOnline) return;
    probing = true;
    cancelRetry();
    void deps
      .probe()
      .catch(() => false)
      .then((ok) => {
        probing = false;
        reachable = ok;
        emit();
        if (!ok && browserOnline) retry = deps.setTimeout(check, retryMs);
      });
  };

  const onOnline = () => {
    browserOnline = true;
    emit();
    if (!reachable) check();
  };
  const onOffline = () => {
    browserOnline = false;
    cancelRetry();
    emit();
  };
  const onVisible = () => {
    if (deps.page?.visibilityState === "visible" && !reachable) check();
  };
  deps.target.addEventListener("online", onOnline);
  deps.target.addEventListener("offline", onOffline);
  deps.page?.addEventListener("visibilitychange", onVisible);

  return {
    isOnline: current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reportFailure: check,
    dispose() {
      cancelRetry();
      deps.target.removeEventListener("online", onOnline);
      deps.target.removeEventListener("offline", onOffline);
      deps.page?.removeEventListener("visibilitychange", onVisible);
      listeners.clear();
    },
  };
}

/**
 * A HEAD request for `sw.js` on Studio's own origin, bypassing the HTTP cache. The service worker never
 * serves it from its caches, so any answer, even a 404, means the network is there.
 */
export function probeOrigin(url: string, timeoutMs = 8000): () => Promise<boolean> {
  return async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      await fetch(url, { method: "HEAD", cache: "no-store", signal: abort.signal });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** The connection the app runs on: the window's events, `navigator.onLine` and a probe of `sw.js`. */
export function browserConnection(): Connection {
  if (typeof window === "undefined") {
    return { isOnline: () => true, subscribe: () => () => {}, reportFailure: () => {}, dispose: () => {} };
  }
  return createConnection({
    target: window,
    page: document,
    onLine: () => navigator.onLine,
    probe: probeOrigin(`${import.meta.env.BASE_URL}sw.js`),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  });
}
