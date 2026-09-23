/**
 * S5e's registrations (contracts §5.2): the console's `log`, the Safe batch dialog (in its own chunk), and Keep log
 * across reloads. Lines logged before this module evaluated are replayed into the log by the kernel.
 */
import { lazy } from "react";
import { env, provideServices, registerDialog } from "@/contracts";
import { startKeepLog } from "./keep-log";
import { appendLine } from "./log-store";

provideServices({ log: appendLine });

registerDialog(
  "safe-batch",
  lazy(() => import("./SafeBatchDialog").then((m) => ({ default: m.SafeBatchDialog }))),
);

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// Under Vitest nothing is kept unless a test starts it with its own storage. Otherwise start after every
// module's registrations, when S1's settings store (read from storage) is in place.
if (!env.test) queueMicrotask(() => startKeepLog(browserStorage()));
