/**
 * Chunk-load failures (spec L831, L605): a lazy chunk this tab needs is gone (a release removed it and the tab
 * never precached it), unreachable, or fails its SRI check. Vite dispatches `vite:preloadError` on `window`
 * when an `import()` it wrapped fails; a failed `import()` that nobody caught surfaces as an unhandled
 * rejection with the browser's own message.
 */

/** The messages browsers and vite-plugin-sri-gen use when a module script can't load. */
const CHUNK_FAILURE = [
  /Failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Failed to load module script/i,
  /Unable to preload CSS/i, // Vite's CSS preload
  /\[vite-plugin-sri-gen\]/, // an integrity check that failed in JavaScript (IPFS build)
];

export function isChunkLoadError(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return CHUNK_FAILURE.some((pattern) => pattern.test(message));
}

type PreloadErrorEvent = Event & { payload?: unknown };

/** Calls `onFailure` for every chunk-load failure `target` (the window) reports. Returns a disposer. */
export function watchChunkErrors(target: EventTarget, onFailure: (reason: unknown) => void): () => void {
  const preload = (event: Event) => onFailure((event as PreloadErrorEvent).payload ?? event);
  const rejection = (event: Event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    if (isChunkLoadError(reason)) onFailure(reason);
  };
  target.addEventListener("vite:preloadError", preload);
  target.addEventListener("unhandledrejection", rejection);
  return () => {
    target.removeEventListener("vite:preloadError", preload);
    target.removeEventListener("unhandledrejection", rejection);
  };
}
