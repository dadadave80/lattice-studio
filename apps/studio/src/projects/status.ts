/**
 * A stored project's status chip (IR "Projects" table, spec L686): reuses C5a's `projectStatus` against the
 * chain of its newest deployment record, so the same live/modified/mismatch precedence the title bar uses
 * applies here. Chain names come from the chain service (S8a) when `ProjectsDialogPanel` has loaded it, else
 * from the static chain table, so "Sepolia" shows before the module loads; a chain Studio doesn't list reads
 * "Chain 5".
 */
import {
  formatStamp, projectStatus, recipeHash, type Deployment, type DiamondState, type Project,
} from "@lattice-studio/core";
import { chainName as knownChainName } from "@/chain/infra/chains";
import { env } from "@/contracts";
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

export function projectRowStatus(
  project: Project, deployments: readonly Deployment[], chainNames?: ReadonlyMap<number, string>,
): { tone: StatusTone; text: string } {
  const ours = deployments.filter((d) => d.projectId === project.id);
  if (ours.length === 0) return { tone: "idle", text: formatStamp({ state: "not-deployed" }) };
  const newest = [...ours].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0];
  const chainId = newest?.chainId ?? null;
  if (chainId === null) return { tone: "idle", text: formatStamp({ state: "not-deployed" }) };
  const hash = recipeHash(project.recipe);
  const chainName = (id: number) => chainNames?.get(id) ?? knownChainName(id, env.e2e);
  const status = projectStatus(project, ours, chainId, hash, chainName);
  return { tone: TONE_OF[status.state], text: status.stamp };
}
