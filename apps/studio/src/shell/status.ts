/**
 * The title bar's status chip (IR L67, spec L686): the diamond's state on the selected chain, from C5a's
 * `projectStatus`, and while a deploy is in flight, from the deploy controller (contracts §5.2).
 */
import type { DiamondState, ProjectStatus } from "@lattice-studio/core";
import { formatStamp, isNotImplemented, projectStatus } from "@lattice-studio/core";
import { useEffect, useMemo, useState } from "react";
import {
  chainService, useAnalysis, useDeployments, useDeployState, useDocument, useSession, type DeployState,
} from "@/contracts";
import type { StatusTone } from "@/ui/status/StatusChip";

export type StatusChipWords = { tone: StatusTone; text: string };

/** The chip's tone per state: idle, pending (proposed, on its way), live, or needing attention. */
export function toneFor(state: DiamondState): StatusTone {
  switch (state) {
    case "live":
      return "live";
    case "pending":
    case "proposed":
      return "pending";
    case "modified":
    case "mismatch":
    case "failed":
      return "attention";
    case "not-deployed":
    case "from-file":
      return "idle";
  }
}

/** Deploy phases where a transaction is out and no record says how it ended yet. */
const IN_FLIGHT = new Set<DeployState["phase"]>(["pending", "stale", "confirmed", "verifying"]);

/**
 * The chip's words. The project's status decides, except while a deploy is in flight on a chain: then the
 * controller's phase does ("Pending · Sepolia", "Proposed · Sepolia (Safe)", "Mismatch · Sepolia") until the
 * record it writes makes the chain live.
 */
export function chipWords(status: ProjectStatus, deploy: DeployState, chainName: (chainId: number) => string): StatusChipWords {
  const chainId = deploy.chainId ?? status.chainId;
  if (chainId !== null && chainId !== undefined) {
    const chain = chainName(chainId);
    const liveHere = status.state === "live" && status.chainId === chainId;
    if (IN_FLIGHT.has(deploy.phase) && !liveHere) return { tone: "pending", text: formatStamp({ state: "pending", chain }) };
    if (deploy.phase === "proposed") return { tone: "pending", text: formatStamp({ state: "proposed", chain }) };
    if (deploy.phase === "mismatch") return { tone: "attention", text: formatStamp({ state: "mismatch", chain }) };
  }
  return { tone: toneFor(status.state), text: status.stamp };
}

const NOT_DEPLOYED: ProjectStatus = {
  state: "not-deployed", stamp: formatStamp({ state: "not-deployed" }), chainId: null, live: [], deployAgain: false,
};

/** Chain names from the chain module, loaded only once a chain is selected (spec L28: the wallet stack loads on demand). */
function useChainNames(chainId: number | null): ReadonlyMap<number, string> {
  const [names, setNames] = useState<ReadonlyMap<number, string>>(() => new Map());
  const known = chainId === null || names.has(chainId);
  useEffect(() => {
    if (known) return;
    let live = true;
    chainService().then(
      (service) => {
        if (live) setNames(new Map(service.chains().map((chain) => [chain.id, chain.name])));
      },
      () => {
        // No chain module yet (S8a): names fall back to "Chain 11155111".
      },
    );
    return () => {
      live = false;
    };
  }, [known]);
  return names;
}

/** The open project's status on the selected chain (C5a), re-rendering when records, chain or recipe change. */
export function useProjectStatus(): { status: ProjectStatus; chainName: (chainId: number) => string } {
  const project = useDocument((s) => s.project);
  const records = useDeployments(project.id);
  const chainId = useSession((s) => s.chainId);
  const recipeHash = useAnalysis((a) => a.recipeHash);
  const names = useChainNames(chainId);
  return useMemo(() => {
    const chainName = (id: number) => names.get(id) ?? `Chain ${id}`;
    const deployments = records.status === "ready" ? records.deployments : [];
    try {
      return { status: projectStatus(project, deployments, chainId, recipeHash, chainName), chainName };
    } catch (error) {
      if (!isNotImplemented(error)) throw error;
      return { status: NOT_DEPLOYED, chainName };
    }
  }, [project, records, chainId, recipeHash, names]);
}

/** The chip's tone and words now. */
export function useStatusChip(): StatusChipWords & { deployAgain: boolean } {
  const { status, chainName } = useProjectStatus();
  const phase = useDeployState((s) => s.phase);
  const deployChain = useDeployState((s) => s.chainId);
  return useMemo(() => {
    const deploy: DeployState = deployChain === undefined ? { phase } : { phase, chainId: deployChain };
    return { ...chipWords(status, deploy, chainName), deployAgain: status.deployAgain };
  }, [status, chainName, phase, deployChain]);
}
