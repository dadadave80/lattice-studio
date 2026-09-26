/**
 * The read-only state (spec L389, Flow 10 steps 7-8): this module is the one writer of `session.readOnly`. It
 * follows S7a's edit lock and S14's catalog pin, sets the reason every document command (and Deploy) shows,
 * and keeps the banner that says why with its way out (IR L204-L206). Entry chunk: no components, no codec.
 */
import type { Hex } from "@lattice-studio/core";
import {
  commandRef, doc, getCatalogStatus, hideBanner, openDialog, session, showBanner, type BannerProps, type CatalogStatus,
} from "@/contracts";
import { defaultEntry, findEntry, type ManifestEntry } from "@/catalog/lookup";
import { resolveCatalogPin, type CatalogPin } from "@/catalog/pin";
import { getCatalogPin, subscribeCatalogPin } from "@/catalog/pin-store";
import type { EditLockState } from "@/persist/lock";
import { editLockState, subscribeEditLock } from "@/persist/current";
import { catalogVersion, ELSEWHERE, HANDED_OVER, READ_ONLY_BANNER, UNBUNDLED } from "./copy";

/** Why the open project can't be edited here, or null. The lock comes first: taking over is the quicker way out. */
export function readOnlyReason(lock: EditLockState, pin: CatalogPin): string | null {
  if (lock.state === "elsewhere") return ELSEWHERE;
  if (lock.state === "handed-over") return HANDED_OVER;
  if (pin.status === "unbundled") return UNBUNDLED;
  return null;
}

/** The banner for that reason (IR L204-L206). */
export function readOnlyBanner(reason: string): BannerProps {
  const action = reason === UNBUNDLED ? commandRef("catalog.migrate") : commandRef("project.takeOverEditing");
  return { text: reason, tone: "warning", actions: [action] };
}

export type MigrationTarget = { ok: true; entry: ManifestEntry } | { ok: false; reason: string };

/**
 * Where Migrate goes (spec L290, L923): an unbundled catalog moves to the build's default (S14's `migrateTo`),
 * and so does a project that stays on an older bundled catalog.
 */
export function migrationTarget(ref: { tag: string; hash: Hex }, status: CatalogStatus): MigrationTarget {
  const pin = resolveCatalogPin(ref, status);
  if (pin.status === "unbundled") {
    return pin.migrateTo ? { ok: true, entry: pin.migrateTo } : { ok: false, reason: "This build bundles no catalog to migrate to" };
  }
  if (pin.status === "unpinned") return { ok: false, reason: "This project isn't on a catalog yet" };
  if (status.status !== "ready" || !status.manifest) return { ok: false, reason: "The catalog hasn't loaded yet" };
  const target = defaultEntry(status.manifest);
  const own = findEntry(status.manifest, ref.hash);
  if (target && own && own.id !== target.id) return { ok: true, entry: target };
  return { ok: false, reason: `This project already uses catalog ${catalogVersion(ref.tag)}` };
}

/** The target's tag for titles, from the stores now (titles take no context). */
export function currentMigrationTag(ref: { tag: string; hash: Hex }): string | null {
  const target = migrationTarget(ref, getCatalogStatus());
  return target.ok ? target.entry.tag : null;
}

type Controller = {
  /** The reason this controller set; it clears only its own. */
  applied: string | null;
  /** The banner it shows, as JSON, so the pin's frequent republishing doesn't re-render it. */
  shown: string | null;
  /** Projects whose Migrate review opened by itself this session (IR L178: "opening an old project or link"). */
  offered: Set<string>;
};

let controller: Controller = { applied: null, shown: null, offered: new Set() };

/** Brings the session and the banner in line with the lock and the pin. Idempotent. */
export function syncReadOnly(lock: EditLockState = editLockState(), pin: CatalogPin = getCatalogPin()): void {
  const reason = readOnlyReason(lock, pin);
  if (reason !== controller.applied) {
    const current = session.get().readOnly;
    if (reason !== null) session.set({ readOnly: reason });
    else if (current !== null && current === controller.applied) session.set({ readOnly: null });
    controller.applied = reason;
  }
  const banner = reason === null ? null : readOnlyBanner(reason);
  const key = banner === null ? null : JSON.stringify(banner);
  if (key !== controller.shown) {
    if (banner === null) hideBanner(READ_ONLY_BANNER);
    else showBanner(READ_ONLY_BANNER, banner);
    controller.shown = key;
  }
  // An unbundled catalog offers its review once per project (IR L178), unless a tab lock is the first problem.
  if (reason === UNBUNDLED && pin.status === "unbundled" && pin.migrateTo) {
    const id = doc.get().id;
    if (!controller.offered.has(id)) {
      controller.offered.add(id);
      if (!session.get().dialogs.some((d) => d.id === "migrate")) openDialog("migrate", { target: pin.migrateTo.id });
    }
  }
}

/** Starts following the lock and the pin. Returns a disposer (tests). */
export function startReadOnly(): () => void {
  const stops = [subscribeEditLock((lock) => syncReadOnly(lock)), subscribeCatalogPin((pin) => syncReadOnly(undefined, pin))];
  return () => {
    for (const stop of stops) stop();
  };
}

/** @internal Tests: forgets what was applied, shown and offered. */
export function resetReadOnly(): void {
  controller = { applied: null, shown: null, offered: new Set() };
}
