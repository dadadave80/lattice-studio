/**
 * The deploy transaction as the review shows it (spec L571, L573): built with C5c's `buildDiamondDeploy` from the
 * analysis' plan and init call for the predicted address, so the Cost section can show its calldata size and the
 * hardware-wallet note its calldata hash; plus the gas against the chain's cap and the fees for that gas.
 */
import type { Address, Analysis, Catalog, ChainState, DiamondDeploy, GasShare, Hex, Project, Result } from "@lattice-studio/core";
import { buildDiamondDeploy, gasShare } from "@lattice-studio/core";
import { useEffect, useMemo, useState } from "react";
import { loadCreationCode } from "@/contracts";
import type { Prediction } from "@/state";
import { readFees, type FeeQuote } from "./fees";
import { parseGas } from "./model";

const ZERO: Address = "0x0000000000000000000000000000000000000000";

export type Fees = { status: "idle"; reason: string } | { status: "loading" } | { status: "ready"; quote: FeeQuote } | { status: "error"; reason: string };

export type Cost = {
  /** The deploy transaction, or why it can't be built yet. */
  deploy: Result<DiamondDeploy, string>;
  gas?: bigint;
  cap?: bigint;
  share?: GasShare;
  fees: Fees;
};

type Inputs = {
  project: Project;
  catalog: Catalog;
  analysis: Analysis;
  prediction: Prediction;
  chain: ChainState | undefined;
  online: boolean;
};

/** The `Lattice` proxy's creation code on the CreateX path (the factory path doesn't need it). */
function useProxyCode(path: Project["deploy"]["path"]): Result<Hex, string> | null {
  const [code, setCode] = useState<Result<Hex, string> | null>(null);
  useEffect(() => {
    if (path !== "createx") return;
    let live = true;
    loadCreationCode("Lattice").then(
      (result) => {
        if (live) setCode(result);
      },
      (error: unknown) => {
        if (live) setCode({ ok: false, error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [path]);
  return path === "createx" ? code : null;
}

export function buildDeploy(inputs: Omit<Inputs, "online">, proxyCode: Result<Hex, string> | null): Result<DiamondDeploy, string> {
  const { project, catalog, analysis, prediction, chain } = inputs;
  if (prediction.status !== "ready") return { ok: false, error: prediction.reason };
  if (analysis.plan.length === 0) return { ok: false, error: "Place facets to build the deploy." };
  const init = analysis.init === null ? { target: ZERO, data: "0x" as Hex } : analysis.init.data === undefined ? null : { target: analysis.init.target, data: analysis.init.data };
  if (!init) return { ok: false, error: "The init's references resolve once a wallet is connected." };
  if (prediction.path === "createx") {
    if (proxyCode === null) return { ok: false, error: "Loading the Lattice proxy's creation code…" };
    if (!proxyCode.ok) return proxyCode;
  }
  try {
    return buildDiamondDeploy({
      recipe: project.recipe,
      catalog,
      plan: analysis.plan,
      init,
      path: prediction.path,
      from: prediction.from,
      salt: prediction.salt,
      chainId: prediction.chainId,
      ...(chain && chain.chainId === prediction.chainId ? { chain } : {}),
      ...(proxyCode?.ok ? { proxyCreationCode: proxyCode.value } : {}),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function useCost(inputs: Inputs): Cost {
  const { project, catalog, analysis, prediction, chain, online } = inputs;
  const proxyCode = useProxyCode(project.deploy.path);
  const deploy = useMemo(
    () => buildDeploy({ project, catalog, analysis, prediction, chain }, proxyCode),
    [project, catalog, analysis, prediction, chain, proxyCode],
  );
  const gas = parseGas(chain?.gasEstimate);
  const cap = parseGas(chain?.gasCap);
  const share = gas !== undefined && cap !== undefined && cap > 0n ? gasShare(gas, cap) : undefined;

  const chainId = prediction.status === "ready" ? prediction.chainId : null;
  const tx = deploy.ok ? deploy.value.tx : null;
  const idle: string | null = !online
    ? "Fees need a connection."
    : chainId === null || tx === null
      ? "Fees show once the deploy is built."
      : gas === undefined
        ? "Fees show once the simulation estimates the gas."
        : null;
  // One read per chain, transaction and gas; until its answer arrives the fees read as loading.
  const key = idle === null && tx !== null ? `${chainId}|${gas}|${tx.to}|${tx.data}` : null;
  const [read, setRead] = useState<{ key: string; fees: Fees } | null>(null);
  useEffect(() => {
    if (key === null || chainId === null || tx === null || gas === undefined) return;
    let live = true;
    readFees(chainId, tx, gas).then((result) => {
      if (!live) return;
      setRead({ key, fees: result.ok ? { status: "ready", quote: result.value } : { status: "error", reason: result.error } });
    });
    return () => {
      live = false;
    };
  }, [key, chainId, tx, gas]);
  const fees: Fees = idle !== null ? { status: "idle", reason: idle } : read?.key === key ? read.fees : { status: "loading" };

  return {
    deploy,
    ...(gas === undefined ? {} : { gas }),
    ...(cap === undefined ? {} : { cap }),
    ...(share === undefined ? {} : { share }),
    fees,
  };
}
