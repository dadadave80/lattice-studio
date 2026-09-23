/**
 * The deploy chunk's entry (contracts §5.2 "deploy"): `deployController()` loads this module and gets the app's one
 * machine. Creating it resumes whatever the open project's records say is in flight (a transaction hash, a Safe
 * proposal) and re-reads From file records; the window regaining focus does it again (spec L580, L857).
 */
import type { DeployController } from "@/contracts";
import { appDeployDeps } from "./app-deps";
import { createDeployMachine, type DeployMachine } from "./machine";

let machine: DeployMachine | null = null;
let stopFocus: (() => void) | null = null;

/** The app's deploy machine, created on first call. */
export function appDeployMachine(): DeployMachine {
  if (machine) return machine;
  const created = createDeployMachine(appDeployDeps());
  machine = created;
  if (typeof window !== "undefined") {
    const onFocus = (): void => void created.refresh();
    window.addEventListener("focus", onFocus);
    stopFocus = () => window.removeEventListener("focus", onFocus);
  }
  void created.refresh();
  return created;
}

/** What `provideDeployController`'s loader resolves to. */
export function loadController(): DeployController {
  return appDeployMachine();
}

/**
 * @internal Tests: serves `next` as the app's machine (a machine over `testing.ts`'s fakes), disposing the one
 * before. Returns a disposer that drops it again.
 */
export function setAppDeployMachine(next: DeployMachine | null): () => void {
  stopFocus?.();
  stopFocus = null;
  if (machine && machine !== next) machine.dispose();
  machine = next;
  return () => {
    if (machine === next) {
      next?.dispose();
      machine = null;
    }
  };
}
