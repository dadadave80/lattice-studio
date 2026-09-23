/**
 * The entry-chunk half of the PWA module, started by `services.ts` in the app (never in tests): chunk-load
 * failures and the Offline banner are watched from the first moment, then `start.ts` loads lazily for the
 * service worker. A failure to load that chunk is itself a chunk failure.
 */
import { hideBanner, isOnline, log, showBanner, subscribeOnline } from "@/contracts";
import { chunkFailureLine, showChunkFailure, watchOffline } from "./banners";
import { watchChunkErrors } from "./chunk-errors";
import type { Connection } from "./connection";
import { pwaState } from "./state";

export type BootDeps = {
  /** Where chunk failures surface (the window). */
  target: EventTarget;
  /** Loads `start.ts`. */
  load(): Promise<{ startPwa(connection: Connection): () => void }>;
};

/** Shows the chunk-failure banner the first time a chunk fails, and logs each failure. */
export function onChunkFailure(reason: unknown): void {
  if (pwaState.markChunkFailed()) showChunkFailure({ showBanner, hideBanner, log }, reason);
  else log(chunkFailureLine(reason));
}

export function bootPwa(connection: Connection, deps: BootDeps): () => void {
  const stopChunks = watchChunkErrors(deps.target, onChunkFailure);
  const stopOffline = watchOffline({ isOnline, subscribe: subscribeOnline, showBanner, hideBanner });
  let stopStart: () => void = () => {};
  let stopped = false;
  deps.load().then(
    (module) => {
      if (!stopped) stopStart = module.startPwa(connection);
    },
    (error: unknown) => onChunkFailure(error),
  );
  return () => {
    stopped = true;
    stopChunks();
    stopOffline();
    stopStart();
  };
}
