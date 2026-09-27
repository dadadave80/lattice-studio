/**
 * The deploy review's pure logic (Flow 12, spec L560-L580): which section each problem belongs to, each
 * section's status mark, the readiness line, the cut's rows with their codehash check, the acknowledgements
 * still to tick, and when Sign & deploy enables. No React, no stores: the components feed it what they read.
 */
import type {
  Address, Analysis, Catalog, ChainState, DeployPath, Hex, PlanEntry, Problem, ProblemCode,
} from "@lattice-studio/core";
import { CREATEX_CODEHASH, planInit, sameAddress } from "@lattice-studio/core";
import type { AccountKind, ChainReadiness, DeployPhase, DeployState } from "@/contracts";
import { env } from "@/contracts";
import { chainName } from "@/chain/infra/chains";
import {
  CHANGED_SINCE_REVIEW, CHOOSE_A_CHAIN, CONNECT_A_WALLET, checking, needsFunds, walletOn, DEPLOY_NEEDS_CONNECTION, SAFE_SIGNS_BY_BATCH, SIMULATING, TYPE_THE_NAME, resolveBlockers, tickFirst,
  type SectionId, type SectionStatus,
} from "./copy";
import { cantSimulate as cantSimulateSentence } from "../deploy/command-copy";
import { ON_ITS_WAY, pathName } from "./entry-copy";

export { IN_FLIGHT_PHASES, pathName } from "./entry-copy";

/** The deploy controller isn't built yet (K2's idle default): its own words. */
export const CONTROLLER_NOT_BUILT = "Not built yet · WP-S8c";

// ---------------------------------------------------------------------------------------------------------
// Problems per section

const SECTION_OF: Partial<Record<ProblemCode, SectionId>> = {
  "NET-02": "network",
  "NET-03": "network",
  "NET-07": "network",
  "NET-01": "address",
  "NET-05": "address",
  "NET-04": "cut",
  "INIT-01": "init",
  "INIT-02": "init",
  "INIT-03": "init",
  "INIT-04": "init",
  "AUTH-01": "authority",
  "AUTH-02": "authority",
  "LINK-01": "authority",
  "NET-06": "cost",
};

/** Where a problem shows in the review. Anything not tied to a section (SEL, SEM, CORE, DEP, STO, INIT-05, NET-08) shows in Checks. */
export function sectionOf(code: ProblemCode): SectionId {
  return SECTION_OF[code] ?? "checks";
}

/** The acknowledgements a problem set needs (spec L326-L342: "Warning (acknowledge)"). */
export function ackProblems(problems: readonly Problem[]): Problem[] {
  return problems.filter((p) => p.ack === true && p.severity === "warning");
}

/** Acknowledgement problems not yet ticked for this recipe hash. */
export function pendingAcks(problems: readonly Problem[], acked: readonly string[]): Problem[] {
  return ackProblems(problems).filter((p) => !acked.includes(p.id));
}

/** The status mark of a section from its problems alone: a blocker blocks, an unticked acknowledgement needs a tick. */
export function problemStatus(problems: readonly Problem[], acked: readonly string[]): SectionStatus {
  if (problems.some((p) => p.severity === "blocker")) return "blocked";
  if (pendingAcks(problems, acked).length > 0) return "tick";
  return "ok";
}

/** The worse of two marks: blocked, then tick, then waiting, then ok. */
export function worse(a: SectionStatus, b: SectionStatus): SectionStatus {
  const rank: Record<SectionStatus, number> = { blocked: 3, tick: 2, waiting: 1, ok: 0 };
  return rank[a] >= rank[b] ? a : b;
}

// ---------------------------------------------------------------------------------------------------------
// Network

/**
 * The shared contracts this deploy needs besides the path's own (spec L563): the facets the plan cuts and the
 * init contracts the plan calls, plus MultiInit when two or more calls remain (contracts §3.1 init encoding).
 */
export function neededContracts(analysis: Pick<Analysis, "plan">, recipe: Parameters<typeof planInit>[0], catalog: Catalog): string[] {
  const names = analysis.plan.map((entry) => entry.facet);
  let steps: { spec: string }[] = [];
  let multi = false;
  try {
    const plan = planInit(recipe, catalog);
    steps = plan.steps;
    multi = plan.kind === "steps" && plan.steps.length >= 2;
  } catch {
    // A stub or a broken plan: the facets alone still say something.
  }
  if (multi) names.push("MultiInit");
  for (const step of steps) {
    const spec = catalog.inits.find((init) => init.name === step.spec);
    if (spec?.release) names.push(spec.contract);
  }
  return [...new Set(names)];
}

/** Whether the path's own contract is on the chain with the expected code. */
export function pathReady(path: DeployPath, chain: ChainState, catalog: Catalog): boolean {
  if (path === "createx") {
    return chain.createx?.present === true && chain.createx.codehash?.toLowerCase() === CREATEX_CODEHASH;
  }
  const factory = chain.shared.LatticeFactory;
  const own = catalog.chains.find((entry) => entry.chainId === chain.chainId)?.factory;
  const expected = (own?.codehash ?? catalog.factory.codehash).toLowerCase();
  return factory?.present === true && (factory.codehash === undefined || factory.codehash.toLowerCase() === expected);
}

/** "Sepolia · LatticeFactory ✓ · 15 of 15 facets and init contracts ✓" (spec L563). */
export function readinessLine(args: { chainName: string; path: DeployPath; chain: ChainState; catalog: Catalog; needed: readonly string[] }): string {
  const { chainName, path, chain, catalog, needed } = args;
  const present = needed.filter((name) => chain.shared[name]?.present === true).length;
  const mark = (ok: boolean) => (ok ? "✓" : "✗");
  return `${chainName} · ${pathName(path)} ${mark(pathReady(path, chain, catalog))} · ${present} of ${needed.length} facets and init contracts ${mark(present === needed.length)}`;
}

// ---------------------------------------------------------------------------------------------------------
// What gets cut

export type CodehashCheck = "matches" | "differs" | "missing" | "unknown";

export type CutRow = PlanEntry & {
  /** The catalog's own selector count, so a partial facet reads "12 of 17 selectors". */
  exported: number;
  check: CodehashCheck;
  /** Where the expected codehash comes from (spec L566): LatticeRegistry where it lists the version, else the catalog tag. */
  source: "registry" | "catalog";
};

/** The plan's rows with the chain's codehash check and the source of each expected codehash (spec L566, L855). */
export function cutRows(plan: readonly PlanEntry[], catalog: Catalog, chain: ChainState | undefined, path: DeployPath): CutRow[] {
  return plan.map((entry) => {
    const facet = catalog.facets.find((f) => f.name === entry.facet);
    const exported = facet?.selectors.length ?? entry.selectors.length;
    const probe = chain?.shared[entry.facet];
    let check: CodehashCheck = "unknown";
    if (probe) {
      if (!probe.present) check = "missing";
      else if (probe.codehash === undefined) check = "unknown";
      else check = probe.codehash.toLowerCase() === entry.codehash.toLowerCase() ? "matches" : "differs";
    }
    // Only whole facets go as RecipeEntry, checked on-chain against LatticeRegistry (spec L855); partial ones are custom cuts.
    const whole = entry.selectors.length === exported;
    const record = chain?.registry?.records[`${entry.facet}@${entry.version}`];
    const listed = record !== null && record !== undefined && sameAddress(record.facet, entry.address)
      && record.codehash.toLowerCase() === entry.codehash.toLowerCase();
    const source = path === "factory" && whole && listed ? "registry" : "catalog";
    return { ...entry, exported, check, source };
  });
}

// ---------------------------------------------------------------------------------------------------------
// Simulation

/** The RPC couldn't simulate at all (spec L573): a failed simulation that carries no revert. */
export function cantSimulate(simulation: DeployState["simulation"]): boolean {
  if (simulation === undefined || simulation.ok) return false;
  // The controller says so outright (spec L575); a failure with no revert to show means the same.
  if (simulation.unavailable === true) return true;
  return simulation.revert === undefined || simulation.revert === "";
}

/**
 * "Changed since review" (spec L562): something the person reviewed changed while the review was open. The mark
 * stays until they sign or the review starts over, so it can be seen whatever the chain's speed.
 */
export function changedSinceReview(deploy: Pick<DeployState, "phase" | "snapshot" | "changedSinceReview">, recipeHash: Hex): boolean {
  return PRE_SIGN_PHASES.has(deploy.phase)
    && (deploy.changedSinceReview === true || (deploy.snapshot !== undefined && deploy.snapshot !== recipeHash));
}

/**
 * Changed and not simulated again yet: the controller is simulating the new inputs, or hasn't taken the edit up
 * yet (the snapshot is an older recipe). "Changed since review. Simulating again." (spec L601) reads only then.
 */
export function resimulating(deploy: Pick<DeployState, "phase" | "snapshot" | "changedSinceReview">, recipeHash: Hex): boolean {
  if (!changedSinceReview(deploy, recipeHash)) return false;
  return deploy.phase === "simulating" || (deploy.snapshot !== undefined && deploy.snapshot !== recipeHash);
}

/**
 * Why Sign & deploy came back to Review while the simulation still stands, for the review to say (spec L574): "You
 * canceled in your wallet.", or another step before the send (an earlier transaction still waiting, the wallet on
 * another chain). Null when there's none, or when the Simulation section already says it (an RPC that can't simulate).
 */
export function signStepNote(
  deploy: Pick<DeployState, "phase" | "error" | "simulation" | "chainId">, chainName: (chainId: number) => string,
): string | null {
  const { phase, error, simulation } = deploy;
  if ((phase !== "review" && phase !== "ready") || !error || simulation === undefined) return null;
  return simulationOwnsError(deploy, chainName) ? null : error;
}

/** A chain named as S8c's controller names it in its sentences (the app's chain table, e2e chains included). */
export function controllerChainName(chainId: number): string {
  return chainName(chainId, env.e2e);
}

/**
 * Whether `deploy.error` is the controller's own "can't simulate" sentence (spec L575), which the Simulation section
 * shows. Told by the controller's `unavailable` flag, then the exact sentence it writes for that chain: a stop at
 * Sign (a refusal in the wallet) replaces the error while the flag stands. `chainName` names chains as the
 * controller does.
 */
export function simulationOwnsError(
  deploy: Pick<DeployState, "error" | "simulation" | "chainId">, chainName: (chainId: number) => string,
): boolean {
  const { error, simulation, chainId } = deploy;
  if (simulation?.unavailable !== true || error === undefined || chainId === undefined) return false;
  return error === cantSimulateSentence(chainName(chainId));
}

/** Phases after Sign & deploy (or a Safe batch): the review shows the deploy's progress instead of its sections. */
export const PROGRESS_PHASES: ReadonlySet<DeployPhase> = new Set<DeployPhase>([
  "awaitingSignature", "pending", "stale", "proposed", "confirmed", "verifying", "live", "mismatch",
]);

/** Before signing: an edit, account or chain change sends the review back to simulating (spec L562). */
export const PRE_SIGN_PHASES: ReadonlySet<DeployPhase> = new Set<DeployPhase>(["review", "simulating", "ready", "failed"]);

/** "0x3f2a…a1c4": a hash's first four and last four hex digits (spec L504). */
export function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}

// ---------------------------------------------------------------------------------------------------------
// Sign & deploy

export type SignInput = {
  online: boolean;
  /** The session's read-only reason (spec L389: Deploy disabled with the same reason). */
  readOnly?: string | null;
  /** `catalogDeployBlock(catalog)`: a fixture catalog can't deploy (contracts §4). */
  catalogBlock: string | null;
  /** The catalog hasn't loaded. */
  catalogLoading?: boolean;
  blockers: number;
  /** `problem.next`'s key in effect, for "Resolve 2 blockers · F8" (spec L661); null when it has none. */
  nextKey: string | null;
  chainId: number | null;
  chainName: string;
  readiness: ChainReadiness;
  account: { address: Address; chainId: number; kind?: AccountKind } | null;
  /** The name of the chain the wallet is on. */
  walletChainName: string;
  deploy: Pick<DeployState, "phase" | "snapshot" | "changedSinceReview" | "simulation" | "error">;
  recipeHash: Hex;
  /** "Needs about 0.012 ETH; this account has 0.004." when the balance can't pay the deploy (Flow 14). */
  fundsShort?: string | null;
  /** Acknowledgements still to tick. */
  pendingAcks: number;
  /** The extra tick when the RPC can't simulate (spec L573). */
  noSimulationTicked: boolean;
  /** A mainnet (when enabled): the project name must be typed (spec L573, L792). */
  mainnet: boolean;
  typedName: string;
  projectName: string;
};

export type Enablement = { ok: true } | { ok: false; reason: string };

/**
 * Sign & deploy (spec L573, IR L238): enabled when nothing blocks, the simulation passed on the current snapshot
 * and every acknowledgement is ticked; on a mainnet the project name must be typed too. Otherwise the first
 * reason, in the order a person would fix them.
 */
export function signEnablement(input: SignInput): Enablement {
  const no = (reason: string): Enablement => ({ ok: false, reason });
  if (input.readOnly) return no(input.readOnly);
  if (!input.online) return no(DEPLOY_NEEDS_CONNECTION);
  if (input.catalogLoading) return no("The catalog hasn't loaded yet");
  if (input.catalogBlock) return no(input.catalogBlock);
  if (input.blockers > 0) return no(resolveBlockers(input.blockers, input.nextKey));
  if (input.chainId === null) return no(CHOOSE_A_CHAIN);
  if (input.readiness.status === "error") return no(input.readiness.reason);
  if (input.readiness.status !== "ready") return no(checking(input.chainName));
  if (!input.account) return no(CONNECT_A_WALLET);
  if (input.account.chainId !== input.chainId) return no(walletOn(input.walletChainName));
  if (input.account.kind === "safe") return no(SAFE_SIGNS_BY_BATCH);
  if (input.fundsShort) return no(input.fundsShort);

  const { deploy } = input;
  const noSimulation = cantSimulate(deploy.simulation);
  const ticks = input.pendingAcks + (noSimulation && !input.noSimulationTicked ? 1 : 0);
  if (ticks > 0) return no(tickFirst(ticks));

  if (deploy.phase === "idle") return no(CONTROLLER_NOT_BUILT);
  if (resimulating(deploy, input.recipeHash)) return no(CHANGED_SINCE_REVIEW);
  if (deploy.phase === "simulating") return no(SIMULATING);
  if (deploy.phase === "awaitingSignature") return no("Waiting for your wallet");
  if (PROGRESS_PHASES.has(deploy.phase)) return no(ON_ITS_WAY);
  const passed = deploy.simulation?.ok === true || noSimulation;
  if (!passed) {
    if (deploy.simulation?.revert) return no(`The simulation reverted: ${deploy.simulation.revert}`);
    // Back in Review with no simulation and why (a stop at Sign that dropped it, a read that failed): not simulating.
    if (deploy.phase === "review" && deploy.simulation === undefined && deploy.error) return no(deploy.error);
    return no(SIMULATING);
  }
  // Review with a result standing is signable too: a rejection in the wallet keeps the simulation (spec L574).
  if (deploy.phase !== "ready" && deploy.phase !== "review") return no(SIMULATING);
  if (input.mainnet && input.typedName.trim() !== input.projectName) return no(TYPE_THE_NAME);
  return { ok: true };
}

/**
 * Flow 14, not enough funds: the deploy's likely cost (the "about" fee plus any L1 data fee) against the account's
 * balance, in the spec's words, or null when it can pay or either side is unknown.
 */
export function fundsShort(
  balance: bigint | undefined,
  fee: { about: bigint; l1?: bigint } | undefined,
  currency: { symbol: string; decimals: number },
): string | null {
  if (balance === undefined || fee === undefined) return null;
  const needed = fee.about + (fee.l1 ?? 0n);
  return balance < needed ? needsFunds(needed, balance, currency.symbol, currency.decimals) : null;
}

// ---------------------------------------------------------------------------------------------------------
// Remove facets (NET-06)

/**
 * Each placed facet's share of the deploy's gas, apportioned by routed selectors (the only per-facet measure the
 * estimate allows: cutting a selector is what costs). Sorted most expensive first, ties in plan order.
 */
export function gasByFacet(plan: readonly PlanEntry[], total: bigint): { facet: string; selectors: number; gas: bigint }[] {
  const selectors = plan.reduce((sum, entry) => sum + entry.selectors.length, 0);
  const rows = plan.map((entry, index) => ({
    facet: entry.facet,
    selectors: entry.selectors.length,
    gas: selectors === 0 ? 0n : (total * BigInt(entry.selectors.length)) / BigInt(selectors),
    index,
  }));
  rows.sort((a, b) => (a.gas === b.gas ? a.index - b.index : a.gas > b.gas ? -1 : 1));
  return rows.map(({ facet, selectors: count, gas }) => ({ facet, selectors: count, gas }));
}

/** "16,777,216" → "16.8M": one decimal above a thousand (spec L682, NET-06). */
export function magnitude(value: bigint): string {
  const n = Number(value);
  const trim = (text: string) => (text.endsWith(".0") ? text.slice(0, -2) : text);
  if (n >= 1_000_000) return `${trim((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1_000) return `${trim((n / 1_000).toFixed(1))}K`;
  return String(n);
}

/** Decimal digits grouped by thousands: 9123456 → "9,123,456". */
export function grouped(value: number | bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A decimal string (as `ChainState` carries gas) as a bigint, or undefined. */
export function parseGas(value: string | undefined): bigint | undefined {
  return value !== undefined && /^\d+$/.test(value) ? BigInt(value) : undefined;
}

/** Hex calldata's size in bytes. */
export function calldataBytes(data: Hex): number {
  return Math.max(0, (data.length - 2) / 2);
}
