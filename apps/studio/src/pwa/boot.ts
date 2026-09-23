/**
 * The entry-chunk half of the PWA module, started by `services.ts` in the app (never in tests): chunk-load
 * failures and the Offline banner are watched from the first moment, then `start.ts` loads lazily for the
 * service worker. A failure to load that chunk is itself a chunk failure. Chunks the service worker never
 * precached (ELK, WalletConnect) fail offline by design; those take the offline path.
 */
import { hideBanner, isOnline, log, showBanner, subscribeOnline } from "@/contracts";
import { chunkFailureLine, offlineChunkLine, showChunkFailure, watchOffline } from "./banners";
import { watchChunkErrors } from "./chunk-errors";
import type { Connection } from "./connection";
import { pwaState } from "./state";

export type BootDeps = {
  /** Where chunk failures surface (the window). */
  target: EventTarget;
  /** Loads `start.ts`. */
  load(): Promise<{ startPwa(connection: Connection): () => void }>;
};

export type ChunkFailureOutcome = "offline" | "updated" | "again";

/**
 * A chunk failed to load. Offline, or when Studio's origin doesn't answer a probe, that's the network, which
 * the Offline banner covers (spec L832): log it and nothing more. Online it's a release this tab can't
 * follow (L605, L831): show "Studio was updated. Save and reload to continue." the first time, and log each
 * failure.
 */
export async function onChunkFailure(
  reason: unknown,
  connection: Pick<Connection, "isOnline" | "check">,
): Promise<ChunkFailureOutcome> {
  const online = connection.isOnline() && (await connection.check());
  if (!online) {
    log(offlineChunkLine(reason));
    return "offline";
  }
  if (pwaState.markChunkFailed()) {
    showChunkFailure({ showBanner, hideBanner, log }, reason);
    return "updated";
  }
  log(chunkFailureLine(reason));
  return "again";
}

export function bootPwa(connection: Connection, deps: BootDeps): () => void {
  const failed = (reason: unknown) => void onChunkFailure(reason, connection);
  const stopChunks = watchChunkErrors(deps.target, failed);
  const stopOffline = watchOffline({ isOnline, subscribe: subscribeOnline, showBanner, hideBanner });
  let stopStart: () => void = () => {};
  let stopped = false;
  deps.load().then(
    (module) => {
      if (!stopped) stopStart = module.startPwa(connection);
    },
    (error: unknown) => failed(error),
  );
  return () => {
    stopped = true;
    stopChunks();
    stopOffline();
    stopStart();
  };
}
