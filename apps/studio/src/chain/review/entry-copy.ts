/**
 * The few words and phase sets the commands need (they're in the entry chunk). Everything else the review says
 * lives in `copy.ts` and `model.ts`, which only the review's lazy chunk imports.
 */
import { plural, type DeployPath } from "@lattice-studio/core";
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

/** The path's display name. */
export function pathName(path: DeployPath): string {
  return path === "createx" ? "CreateX" : "LatticeFactory";
}

/** A deploy on its way: Deploy… reopens the review at its progress instead of starting a new one (IR L207). */
export const IN_FLIGHT_PHASES: ReadonlySet<DeployPhase> = new Set<DeployPhase>([
  "awaitingSignature", "pending", "stale", "proposed", "confirmed", "verifying",
]);
