/**
 * @internal For the contracts' own `bun test` files: every piece of module state back to K2's defaults for
 * one test, and back to what it was afterwards, so no test depends on bun's file order. Module-level
 * subscribers from other test files (every tracked listener set: store relays, analysis, catalog, commands,
 * services, deploy) are set aside for the test and put back after it.
 */
import { resetAnalysis } from "./analysis";
import { resetCatalog } from "./catalog";
import { snapshotCommands } from "./commands";
import { resetDeploy } from "./deploy";
import { isolateListeners } from "./relay";
import { clearDeploymentCache, resetServices } from "./services";
import { resetStores } from "./stores";

export function isolateContracts(): () => void {
  const restoreListeners = isolateListeners();
  const disposers = [
    resetStores(),
    resetServices(),
    resetCatalog(),
    resetAnalysis(),
    resetDeploy(),
    snapshotCommands({ pristine: true }),
  ];
  clearDeploymentCache();
  return () => {
    // Drop whatever the test left subscribed before restoring state, so it hears none of the restore.
    isolateListeners();
    for (const dispose of disposers.reverse()) dispose();
    clearDeploymentCache();
    restoreListeners();
  };
}
