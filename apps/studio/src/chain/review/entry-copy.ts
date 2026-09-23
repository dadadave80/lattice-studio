/**
 * The few words and phase sets the commands need (they're in the entry chunk). Everything else the review says
 * lives in `copy.ts` and `model.ts`, which only the review's lazy chunk imports.
 */
import { plural, type DeployPath, type Scope } from "@lattice-studio/core";
import type { DeployPhase } from "@/contracts";

/** Spec L561, IR L13: Deploy offline; ⌘/Ctrl+Enter only announces it. */
export const DEPLOY_NEEDS_CONNECTION = "Deploy needs a connection";

/** Spec L385: Deploy while a Safe proposal waits. */
export const WAITING_FOR_SAFE = "Waiting for the Safe to execute the batch";

/** Spec L382, L661: Deploy disabled while blockers remain. */
export function resolveBlockers(count: number): string {
  return `Resolve ${plural(count, "blocker")} · F8`;
}

/** Why Sign & deploy (or the Safe batch) waits on the acknowledgements (spec L573). */
export function tickFirst(count: number): string {
  return count === 1 ? "Tick the acknowledgement first" : `Tick the ${count} acknowledgements first`;
}

/** A deploy is on its way: nothing in the review can change it now. */
export const ON_ITS_WAY = "This deploy is already on its way";

/** IR L231: the salt's scope on the CreateX path. */
export const SCOPE_TITLES: Readonly<Record<Scope, string>> = {
  "every-chain": "Same address on every chain",
  "this-chain": "This chain only",
};

/** Contracts §4: a fixture catalog can't deploy (the words S8a's `catalogDeployBlock` uses). */
export const FIXTURE_CATALOG = "Fixture catalog: build the real catalog first";

/** Why a catalog with this tag can't deploy, or null (S8a's `catalogDeployBlock`, without importing its module). */
export function fixtureBlock(tag: string): string | null {
  return tag === "fixture" || tag.startsWith("fixture-") ? FIXTURE_CATALOG : null;
}

/** The path's display name. */
export function pathName(path: DeployPath): string {
  return path === "createx" ? "CreateX" : "LatticeFactory";
}

/** A deploy on its way: Deploy… reopens the review at its progress instead of starting a new one (IR L207). */
export const IN_FLIGHT_PHASES: ReadonlySet<DeployPhase> = new Set<DeployPhase>([
  "awaitingSignature", "pending", "stale", "proposed", "confirmed", "verifying",
]);
