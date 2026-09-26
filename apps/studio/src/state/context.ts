/**
 * The `AnalysisContext` of the open document (spec L268-L272, contracts §3.1): what lives beside the recipe.
 *
 * - `deploy` and `refs` from the current prediction: the selected chain, the path, the connected account and
 *   the salt built from it; "This diamond" is the predicted address, "Deploying account" the account.
 * - `known` and `knownFrom` from `project.predicted` and the project's deployment records. The current
 *   prediction is left out: AUTH-02 is about addresses this diamond had before (spec L333).
 * - `unconfirmed` and `unconfirmedFrom` from `project.provenance`: argument paths that came from a link or a
 *   file (LINK-01 keeps only the ones that receive authority).
 * - `chain` from the selected chain's readiness, once its probes are in.
 */
import type { Address, AnalysisContext, ChainState, Deployment, Project } from "@lattice-studio/core";
import { sameAddress, toChecksum } from "@lattice-studio/core";
import type { WalletAccount } from "@/contracts";
import type { Prediction } from "./prediction";

export type ContextInput = {
  project: Pick<Project, "predicted" | "provenance">;
  prediction: Prediction;
  account: Pick<WalletAccount, "address"> | null;
  deployments: readonly Deployment[];
  /** The selected chain's probes, when ready. */
  chain?: ChainState | undefined;
  chainName?: (chainId: number) => string | undefined;
};

type KnownFrom = NonNullable<AnalysisContext["knownFrom"]>;

export function buildContext(input: ContextInput): AnalysisContext {
  const { project, prediction, account, deployments, chain, chainName } = input;
  const ctx: AnalysisContext = { known: [], unconfirmed: [] };

  if (prediction.status === "ready") {
    ctx.deploy = { chainId: prediction.chainId, path: prediction.path, from: prediction.from, salt: prediction.salt };
    ctx.refs = { self: prediction.address, deployer: prediction.from };
  } else if (account) {
    ctx.refs = { deployer: toChecksum(account.address) };
  }

  const current = prediction.status === "ready" ? prediction.address : null;
  const known: Address[] = [];
  const knownFrom: KnownFrom = {};
  const add = (address: Address, from: KnownFrom[string]): void => {
    const key = address.toLowerCase();
    if (!knownFrom[key]) known.push(toChecksum(address));
    // A recorded deployment says more than a prediction of the same address.
    if (!knownFrom[key] || from.source === "deployment") knownFrom[key] = from;
  };
  const named = (chainId: number): { chain?: string } => {
    const name = chainName?.(chainId);
    return name === undefined ? {} : { chain: name };
  };
  for (const p of project.predicted) {
    if (current !== null && sameAddress(p.address, current)) continue;
    add(p.address, { source: "prediction", chainId: p.chainId, ...named(p.chainId) });
  }
  for (const d of deployments) add(d.address, { source: "deployment", chainId: d.chainId, ...named(d.chainId) });
  if (known.length > 0) {
    ctx.known = known;
    ctx.knownFrom = knownFrom;
  }

  const unconfirmedFrom: Record<string, "link" | "file"> = {};
  for (const path of Object.keys(project.provenance).sort()) {
    const source = project.provenance[path];
    if (source === "link" || source === "file") unconfirmedFrom[path] = source;
  }
  const unconfirmed = Object.keys(unconfirmedFrom);
  if (unconfirmed.length > 0) {
    ctx.unconfirmed = unconfirmed;
    ctx.unconfirmedFrom = unconfirmedFrom;
  }

  if (chain) ctx.chain = chain;
  return ctx;
}
