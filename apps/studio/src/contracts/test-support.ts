/**
 * @internal For the contracts' own `bun test` files: every piece of module state back to K2's defaults
 * for one test, and back to what it was afterwards, so no test depends on bun's file order.
 */
import { resetAnalysis } from "./analysis";
import { resetCatalog } from "./catalog";
import { snapshotCommands } from "./commands";
import { resetDeploy } from "./deploy";
import { clearDeploymentCache, resetServices } from "./services";
import { resetStores } from "./stores";

export function isolateContracts(): () => void {
  const disposers = [
    resetServices(),
    resetStores(),
    resetCatalog(),
    resetAnalysis(),
    resetDeploy(),
    snapshotCommands({ pristine: true }),
  ];
  clearDeploymentCache();
  return () => {
    for (const dispose of disposers.reverse()) dispose();
    clearDeploymentCache();
  };
}
