/**
 * The open project's deployment records and what they say about the selected chain (C5a's `projectStatus`),
 * with chain names and explorers from the chain module once it's needed.
 */
import type { Deployment, ProjectStatus } from "@lattice-studio/core";
import { projectStatus } from "@lattice-studio/core";
import { useMemo } from "react";
import { useAnalysis, useDeployments, useDocument, useSession, type ChainInfo } from "@/contracts";
import { chainNameOf, useChainService, useChains, type ChainAccess } from "./use-chain";

export type DeployStatus = {
  /** Null until the first read of the records returns. */
  deployments: readonly Deployment[] | null;
  status: ProjectStatus;
  chain: ChainAccess;
  chains: readonly ChainInfo[];
  chainName(chainId: number): string;
};

const NONE: readonly Deployment[] = Object.freeze([]);

/**
 * `recordChains`: also load the chain module when there are records to name and check, not only once a chain is
 * selected. The Deployments list and the Comparison view ask for it; the footer doesn't, so the footer never
 * pulls in the wallet stack on its own (spec L25, decision 13).
 */
export function useDeployStatus(options: { recordChains?: boolean } = {}): DeployStatus {
  const project = useDocument((s) => s.project);
  const chainId = useSession((s) => s.chainId);
  const recipeHash = useAnalysis((a) => a.recipeHash);
  const records = useDeployments(project.id);
  const deployments = records.status === "ready" ? records.deployments : null;
  const chain = useChainService(chainId !== null || (options.recordChains === true && (deployments?.length ?? 0) > 0));
  const chains = useChains(chain);
  return useMemo(() => {
    const chainName = (id: number): string => chainNameOf(chains, id);
    const status = projectStatus(project, deployments ?? NONE, chainId, recipeHash, chainName);
    return { deployments, status, chain, chains, chainName };
  }, [project, deployments, chainId, recipeHash, chain, chains]);
}

/** The block explorer page for an address, when the chain module knows the chain's explorer. */
export function explorerUrl(chains: readonly ChainInfo[], chainId: number, address: string): string | null {
  const base = chains.find((chain) => chain.id === chainId)?.explorer;
  return base ? `${base.replace(/\/$/, "")}/address/${address}` : null;
}

/** Louper's page for a diamond: `https://louper.dev/diamond/<address>?network=<chain>`. */
export function louperUrl(chains: readonly ChainInfo[], chainId: number, address: string): string {
  const name = chainNameOf(chains, chainId).toLowerCase().replace(/\s+/g, "-");
  return `https://louper.dev/diamond/${address}?network=${encodeURIComponent(name)}`;
}
