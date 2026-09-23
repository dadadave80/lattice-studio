/**
 * A stored project's status chip (IR "Projects" table, spec L686): reuses C5a's `projectStatus` against the
 * chain of its newest deployment record, so the same live/modified/mismatch precedence the title bar uses
 * applies here. No chain-name service reaches the Projects list, so chains show as "Chain 11155111"
 * (Interpretation, S7b's report).
 */
import {
  formatStamp, projectStatus, recipeHash, type Deployment, type DiamondState, type Project,
} from "@lattice-studio/core";
import type { StatusTone } from "@/ui";

const TONE_OF: Record<DiamondState, StatusTone> = {
  "not-deployed": "idle",
  "from-file": "idle",
  pending: "pending",
  proposed: "pending",
  live: "live",
  modified: "attention",
  mismatch: "attention",
  failed: "attention",
};

function chainName(chainId: number): string {
  return `Chain ${chainId}`;
}

export function projectRowStatus(project: Project, deployments: readonly Deployment[]): { tone: StatusTone; text: string } {
  const ours = deployments.filter((d) => d.projectId === project.id);
  if (ours.length === 0) return { tone: "idle", text: formatStamp({ state: "not-deployed" }) };
  const newest = [...ours].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0];
  const chainId = newest?.chainId ?? null;
  if (chainId === null) return { tone: "idle", text: formatStamp({ state: "not-deployed" }) };
  const hash = recipeHash(project.recipe);
  const status = projectStatus(project, ours, chainId, hash, chainName);
  return { tone: TONE_OF[status.state], text: status.stamp };
}
