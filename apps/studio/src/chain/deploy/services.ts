/**
 * S8c's registrations (contracts §5.2 "deploy"): the deploy controller's loader (its own chunk), the missing-contracts
 * sub-step dialog (its own chunk), and, right after startup, the watchers of `tracking.ts` (their own small chunk):
 * resume tracking from the open project's records (spec L558) and say when an edit leaves what's live (spec L728).
 * Under Vitest the watchers stay off: tests start them. Light: nothing here opens IndexedDB at module evaluation or
 * imports the chain module.
 */
import { env, provideDeployController, registerDialog } from "@/contracts";
import { MissingContractsDialogChunk } from "./MissingContractsDialogChunk";

provideDeployController(() => import("./controller").then((m) => m.loadController()));

registerDialog("missing-contracts", MissingContractsDialogChunk);

if (!env.test) {
  import("./tracking").then((m) => m.startWatching(), (error: unknown) => console.error(error));
}
