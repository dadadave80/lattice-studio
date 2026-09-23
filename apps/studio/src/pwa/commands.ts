/** S11a's commands (contracts §5.3): `app.reload` and `app.saveAndReload`. */
import { announce, command, defineCommands, log, saveStatus, subscribeSaveStatus } from "@/contracts";
import { reloadEnablement, reloadStudio, saveAndReload, saveAndReloadEnablement, type ReloadDeps } from "./reload";
import { pwaState } from "./state";

export function liveReloadDeps(): ReloadDeps {
  return {
    saveStatus,
    subscribeSaveStatus,
    updates: pwaState.updates,
    reloadPage: pwaState.reloadPage,
    log,
    announce: (text) => announce(text),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  };
}

defineCommands([
  command({
    id: "app.reload",
    title: () => "Reload",
    category: "Session",
    enabled: () => reloadEnablement(saveStatus()),
    run: async () => {
      await reloadStudio(liveReloadDeps());
    },
  }),
  command({
    id: "app.saveAndReload",
    title: () => "Save and reload",
    category: "Session",
    enabled: () => saveAndReloadEnablement(saveStatus()),
    run: async () => {
      await saveAndReload(liveReloadDeps());
    },
  }),
]);
