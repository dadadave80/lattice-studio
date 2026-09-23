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
import { safeToReload } from "./updates";

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

async function reload(deps: ReloadDeps): Promise<void> {
  const updates = deps.updates();
  if (updates) await updates.reload();
  else deps.reloadPage();
}

function refuse(deps: ReloadDeps, text: string): void {
  deps.log({ tag: "Note", text });
  deps.announce(text);
}

export type ReloadOutcome = "reloaded" | "not-saved" | "still-saving";

/** Reloads now if nothing would be lost, else says why not. */
export async function reloadStudio(deps: ReloadDeps): Promise<ReloadOutcome> {
  const status = deps.saveStatus();
  if (!safeToReload(status)) {
    refuse(deps, `Didn't reload: ${status.state === "not-saved" ? notSavedReason(status) : RELOAD_WAITS.toLowerCase()}.`);
    return status.state === "not-saved" ? "not-saved" : "still-saving";
  }
  await reload(deps);
  return "reloaded";
}

/** Waits for the pending save (up to `waitMs`), then reloads; says why when it can't. */
export async function saveAndReload(deps: ReloadDeps): Promise<ReloadOutcome> {
  const settled = await new Promise<SaveStatus | null>((resolve) => {
    const first = deps.saveStatus();
    if (first.state !== "saving") {
      resolve(first);
      return;
    }
    let timer: unknown = null;
    const stop = deps.subscribeSaveStatus((status) => {
      if (status.state === "saving") return;
      finish(status);
    });
    function finish(status: SaveStatus | null): void {
      stop();
      if (timer !== null) deps.clearTimeout(timer);
      resolve(status);
    }
    timer = deps.setTimeout(() => finish(null), deps.waitMs ?? 10_000);
  });
  if (settled === null) {
    refuse(deps, "Didn't reload: the project is still saving. Try Save and reload again.");
    return "still-saving";
  }
  if (!safeToReload(settled)) {
    refuse(deps, `Didn't reload: ${notSavedReason(settled)}.`);
    return "not-saved";
  }
  await reload(deps);
  return "reloaded";
}
