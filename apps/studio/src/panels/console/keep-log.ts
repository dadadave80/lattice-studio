/**
 * Keep log across reloads (IR L134, settings `keepLog`): follows the setting, writes the log to `storage` while
 * it's on, and puts the kept lines back when it starts.
 */
import { settings } from "@/contracts";
import { flushLogPersistence, restoreLog, setKeepLog, setLogStorage, type LogStorage } from "./log-store";

/** Starts keeping per the setting; returns a disposer. Restores what was kept when the setting is on. */
export function startKeepLog(storage: LogStorage | null): () => void {
  setLogStorage(storage);
  setKeepLog(settings.get().keepLog);
  restoreLog();
  const stop = settings.subscribe((next, previous) => {
    if (next.keepLog !== previous.keepLog) setKeepLog(next.keepLog);
  });
  const hide = () => flushLogPersistence();
  if (typeof window !== "undefined") window.addEventListener("pagehide", hide);
  return () => {
    stop();
    if (typeof window !== "undefined") window.removeEventListener("pagehide", hide);
    flushLogPersistence();
    setLogStorage(null);
  };
}
