/**
 * When an export can run (spec L513-L517, L699): the `enabled` checks the export commands register with, and
 * the key their blocker reason names. In the entry chunk with the registrations, so it imports only the
 * contracts and the key labels the shortcut chips already bring; building, saving and copying a file live in
 * `actions.ts`, behind the console body's boundary.
 */
import type { Analysis, Platform, Problem } from "@lattice-studio/core";
import { isCoreOnly } from "@lattice-studio/core";
import { listBindings, type BindingId, type CommandContext, type Enablement, type SessionState, type SettingsState } from "@/contracts";
import { firstKeys, keyLabel } from "@/ui/keys/key-labels";
import { liveSpecs } from "@/ui/keys/use-aria-key-shortcuts";
import { platform as currentPlatform } from "@/ui/shared/platform";
import { blockerCount, CATALOG_NOT_LOADED, PLACE_FACETS_FIRST, resolveToExport, tickAcknowledgementsFirst } from "./export-enablement";

/** What a key label reads from: the keymap and the single-key switch in effect, and the platform. */
export type KeyView = Pick<SettingsState, "keymap" | "singleKeys"> & { platform: Platform };

/** The keys in effect now, for code outside render (a command's `enabled`). */
export function currentKeyView(settings: Pick<SettingsState, "keymap" | "singleKeys">): KeyView {
  return { keymap: settings.keymap, singleKeys: settings.singleKeys, platform: currentPlatform() };
}

/**
 * A binding's key as a chip shows it ("F8", "⇧⌘J"), with the keymap applied (spec L660: one registry feeds
 * shortcuts and tooltips). Null when it has no key here, or only a single-key one while those are off.
 */
export function bindingKey(id: BindingId, view: KeyView): string | null {
  const specs = listBindings(view.keymap).find((b) => b.id === id)?.keys;
  const keys = firstKeys(liveSpecs(specs, view.platform, view.singleKeys), view.platform);
  return keys === null ? null : keyLabel(keys, view.platform);
}

/** `problem.next`'s key in effect, for "Resolve 2 blockers to export · F8" (spec L661). */
export function nextProblemKey(view: KeyView): string | null {
  return bindingKey("problem.next", view);
}

const OK: Enablement = { ok: true };

/** Enabled when the catalog is in; the brief and recipe.json export whatever the sheet holds (spec L514-L515). */
export function alwaysExportable(ctx: Pick<CommandContext, "catalog">): Enablement {
  return ctx.catalog ? OK : { ok: false, reason: CATALOG_NOT_LOADED };
}

/** The Foundry script and the Safe batch: facets placed and no blockers (spec L513, L517). */
export function deployableExport(ctx: Pick<CommandContext, "catalog" | "project" | "analysis" | "settings">): Enablement {
  if (!ctx.catalog) return { ok: false, reason: CATALOG_NOT_LOADED };
  if (isCoreOnly(ctx.project.recipe)) return { ok: false, reason: PLACE_FACETS_FIRST };
  const blockers = blockerCount(ctx.analysis);
  if (blockers > 0) {
    const reason = resolveToExport(blockers, nextProblemKey(currentKeyView(ctx.settings)));
    return { ok: false, reason, fix: { id: "problem.next" } };
  }
  return OK;
}

/** Acknowledgement problems (spec L326-L342) not yet ticked for this recipe hash; the same filter as `chain/review/model.ts`'s `pendingAcks`. */
function pendingAcks(session: Pick<SessionState, "acks">, analysis: Pick<Analysis, "problems" | "recipeHash">): Problem[] {
  const acked = session.acks[analysis.recipeHash] ?? [];
  return analysis.problems.filter((p) => p.ack === true && p.severity === "warning" && !acked.includes(p.id));
}

/**
 * The Safe batch: `deployableExport`'s gates, then every acknowledgement ticked, the same consent a signed
 * deploy asks for (spec L573; S8b's `deploy.downloadSafeBatch` waits on the same problems).
 */
export function safeExportable(ctx: Pick<CommandContext, "catalog" | "project" | "analysis" | "session" | "settings">): Enablement {
  const base = deployableExport(ctx);
  if (!base.ok) return base;
  const pending = pendingAcks(ctx.session, ctx.analysis);
  if (pending.length > 0) return { ok: false, reason: tickAcknowledgementsFirst(pending.length) };
  return OK;
}
