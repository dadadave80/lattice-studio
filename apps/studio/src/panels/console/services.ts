/**
 * S5e's registrations (contracts §5.2): the console's `log`, the Safe batch dialog (in its own chunk), and Keep log
 * across reloads. Lines logged before this module evaluated are replayed into the log by the kernel. Deploy output
 * is announced per the Deploy announcements setting; the deploy's own lines start after the last one logged while
 * no deploy was under way.
 */
import type { ConsoleLine } from "@lattice-studio/core";
import { lazy } from "react";
import { announce, deployState, env, provideServices, registerDialog, settings, subscribeDeployState } from "@/contracts";
import { deployAnnouncement } from "./deploy-announce";
import { startKeepLog } from "./keep-log";
import { appendLine, markDeployStart } from "./log-store";
import { STREAMING } from "./summary";

function logLine(line: ConsoleLine): void {
  appendLine(line);
  const said = deployAnnouncement(line, settings.get().deployAnnouncements, deployState().phase);
  if (said) announce(said.text, said.options);
}

provideServices({ log: logLine });

let streaming = STREAMING.has(deployState().phase);
subscribeDeployState((state) => {
  const now = STREAMING.has(state.phase);
  // Leaving idle or review for the wallet: the summary streams only what this deploy logs from here.
  if (now && !streaming) markDeployStart();
  streaming = now;
});

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
