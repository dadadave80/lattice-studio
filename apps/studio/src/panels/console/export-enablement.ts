/**
 * When an export can run (spec L513-L517, L699): the `enabled` checks the export commands register with and the
 * reasons they give. In the entry chunk with the registrations, so it imports nothing but the contracts; building,
 * saving and copying a file live in `actions.ts`, behind the console body's boundary.
 */
import type { Analysis, Problem } from "@lattice-studio/core";
import { plural } from "@lattice-studio/core";
import type { CommandContext, Enablement, SessionState } from "@/contracts";

/** While the catalog loads or after it failed. */
export const CATALOG_NOT_LOADED = "The catalog hasn't loaded yet";
/** An empty sheet has nothing to export (spec L378's "Place facets first"). */
export const PLACE_FACETS_FIRST = "Place facets first";
/** The Script and Recipe JSON tabs on an empty sheet (spec L699). */
export const PLACE_FACETS_TO_GENERATE = "Place facets to generate a script.";

/** "Resolve 2 blockers to export · F8" (spec L513, L699). */
export function resolveToExport(blockers: number): string {
  return `Resolve ${plural(blockers, "blocker")} to export · F8`;
}

export function blockerCount(analysis: Pick<Analysis, "problems">): number {
  return analysis.problems.filter((p) => p.severity === "blocker").length;
}

const OK: Enablement = { ok: true };

/** Enabled when the catalog is in; the brief and recipe.json export whatever the sheet holds (spec L514-L515). */
export function alwaysExportable(ctx: Pick<CommandContext, "catalog">): Enablement {
  return ctx.catalog ? OK : { ok: false, reason: CATALOG_NOT_LOADED };
}

/** The Foundry script and the Safe batch: facets placed and no blockers (spec L513, L517). */
export function deployableExport(ctx: Pick<CommandContext, "catalog" | "project" | "analysis">): Enablement {
  if (!ctx.catalog) return { ok: false, reason: CATALOG_NOT_LOADED };
  if (ctx.project.recipe.facets.length === 0) return { ok: false, reason: PLACE_FACETS_FIRST };
  const blockers = blockerCount(ctx.analysis);
  if (blockers > 0) return { ok: false, reason: resolveToExport(blockers), fix: { id: "problem.next" } };
  return OK;
}

/** "Tick the acknowledgement first" (the same words as `chain/review/entry-copy.ts`'s `tickFirst`, spec L573). */
export function tickAcknowledgementsFirst(count: number): string {
  return count === 1 ? "Tick the acknowledgement first" : `Tick the ${count} acknowledgements first`;
}

/** Acknowledgement problems (spec L326-L342) not yet ticked for this recipe hash. */
function pendingAcks(session: Pick<SessionState, "acks">, analysis: Pick<Analysis, "problems" | "recipeHash">): Problem[] {
  const acked = session.acks[analysis.recipeHash] ?? [];
  return analysis.problems.filter((p) => p.ack === true && p.severity === "warning" && !acked.includes(p.id));
}

/**
 * The Safe batch: `deployableExport`'s gates, then every acknowledgement ticked, the same consent a signed
 * deploy asks for (spec L573; S8b's `deploy.downloadSafeBatch` waits on the same problems).
 */
export function safeExportable(ctx: Pick<CommandContext, "catalog" | "project" | "analysis" | "session">): Enablement {
  const base = deployableExport(ctx);
  if (!base.ok) return base;
  const pending = pendingAcks(ctx.session, ctx.analysis);
  if (pending.length > 0) return { ok: false, reason: tickAcknowledgementsFirst(pending.length) };
  return OK;
}
