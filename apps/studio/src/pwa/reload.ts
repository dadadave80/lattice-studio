/**
 * `app.reload` and `app.saveAndReload` (contracts §5.3, spec L831). Neither reloads over unsaved work:
 * **Reload** is enabled once the project is saved, and **Save and reload** waits for the pending autosave
 * (debounced 750 ms, spec L845) before it reloads. When the project can't be saved (storage full), both say
 * why and point to Save a copy instead. Reloading activates a waiting service worker first, so the reload
 * gets the new version.
 */
import type { CommandRef, LineDraft } from "@lattice-studio/core";
import type { Enablement, SaveStatus } from "@/contracts";
import { RELOAD_WAITS } from "./copy";
import type { UpdateHandle } from "./state";
import { safeToReload, settledSave } from "./saved";

const SAVE_A_COPY: CommandRef = { id: "project.saveCopy" };
const SAVE_AND_RELOAD: CommandRef = { id: "app.saveAndReload" };

/** "Not saved: browser storage is full", with the status's detail when it has one. */
export function notSavedReason(status: SaveStatus): string {
  return status.detail ? `${status.text} · ${status.detail}` : status.text;
}

export function reloadEnablement(status: SaveStatus): Enablement {
  if (safeToReload(status)) return { ok: true };
  if (status.state === "not-saved") return { ok: false, reason: notSavedReason(status), fix: SAVE_A_COPY };
  return { ok: false, reason: RELOAD_WAITS, fix: SAVE_AND_RELOAD };
}

export function saveAndReloadEnablement(status: SaveStatus): Enablement {
  if (status.state === "not-saved") return { ok: false, reason: notSavedReason(status), fix: SAVE_A_COPY };
  return { ok: true };
}

export type ReloadDeps = {
  saveStatus(): SaveStatus;
  subscribeSaveStatus(listener: (status: SaveStatus) => void): () => void;
  updates(): UpdateHandle | null;
  reloadPage(): void;
  log(line: LineDraft): void;
  announce(text: string): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** How long Save and reload waits for the save. Default 10 s. */
  waitMs?: number;
};

function refuse(deps: ReloadDeps, text: string): void {
  deps.log({ tag: "Note", text });
  deps.announce(text);
}

export type ReloadOutcome = "reloaded" | "not-saved" | "still-saving";

const STILL_SAVING = "Didn't reload: the project is still saving. Try Save and reload again.";

/** Reloads through the update controller when one runs (it activates a waiting worker first). */
async function reload(deps: ReloadDeps): Promise<ReloadOutcome> {
  const updates = deps.updates();
  if (!updates) {
    deps.reloadPage();
    return "reloaded";
  }
  if (await updates.reload()) return "reloaded";
  // An edit arrived while the new worker took over, and its save didn't settle.
  const status = deps.saveStatus();
  if (status.state === "not-saved") {
    refuse(deps, `Didn't reload: ${notSavedReason(status)}.`);
    return "not-saved";
  }
  refuse(deps, STILL_SAVING);
  return "still-saving";
}

/** Reloads now if nothing would be lost, else says why not. */
export async function reloadStudio(deps: ReloadDeps): Promise<ReloadOutcome> {
  const status = deps.saveStatus();
  if (!safeToReload(status)) {
    refuse(deps, `Didn't reload: ${status.state === "not-saved" ? notSavedReason(status) : RELOAD_WAITS.toLowerCase()}.`);
    return status.state === "not-saved" ? "not-saved" : "still-saving";
  }
  return reload(deps);
}

/** Waits for the pending save (up to `waitMs`), then reloads; says why when it can't. */
export async function saveAndReload(deps: ReloadDeps): Promise<ReloadOutcome> {
  const settled = await settledSave(deps, deps.waitMs ?? 10_000);
  if (settled === null) {
    refuse(deps, STILL_SAVING);
    return "still-saving";
  }
  if (!safeToReload(settled)) {
    refuse(deps, `Didn't reload: ${notSavedReason(settled)}.`);
    return "not-saved";
  }
  return reload(deps);
}
