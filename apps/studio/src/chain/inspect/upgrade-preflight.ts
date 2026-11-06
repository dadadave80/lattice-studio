import {
  buildUpgradeCuts, encodeInit, err, isAddress, isHexAnyCase, ok, planInit, planUpgrade, resolveUpgrade,
  type Address, type AnalysisContext, type Catalog, type Hex, type Project, type Result, type TxRequest, type UpgradeBaseline, type UpgradeOrigin, type UpgradePlan,
} from "@lattice-studio/core";
import { encodeFunctionData, keccak256, parseAbi } from "viem";
import type { DiamondSnapshot, SnapshotReadError } from "./snapshot";
import type { InspectionTarget } from "./engine";
import { readUpgradeAuthority, type UpgradeAuthority, type UpgradeAuthorityCall } from "./upgrade-authority";
import type { UpgradeReviewDetails } from "./upgrade-review-ports";

export const UPGRADE_ABI = parseAbi(["function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] cuts,address init,bytes data) payable"]);
export type UpgradeCode = { label: string; address: Address; codehash: Hex };
export type UpgradePreflightPorts = {
  inspect(target: InspectionTarget, signal: AbortSignal): Promise<Result<DiamondSnapshot, SnapshotReadError>>;
  catalogs(): Promise<Result<readonly Catalog[], string>>;
  call: UpgradeAuthorityCall;
  codeAt(chainId: number, address: Address, blockHash: Hex): Promise<Result<Hex, string>>;
  chainName(chainId: number): string;
};
export type PreparedUpgrade = {
  project: Project;
  catalog: Catalog;
  from: Address;
  snapshot: DiamondSnapshot;
  plan: UpgradePlan;
  tx: TxRequest;
  authority: UpgradeAuthority;
  requiredCode: readonly UpgradeCode[];
  details: UpgradeReviewDetails;
};

/** The proxy's code participates even when it has no immutable/self loupe row. */
export function upgradeBaseline(snapshot: DiamondSnapshot, diamond: Address): Result<UpgradeBaseline, string> {
  if (snapshot.code === "0x" || !isHexAnyCase(snapshot.code) || snapshot.facets === null) return err("The diamond needs runtime code and a readable loupe.");
  return ok({ block: snapshot.block, blockHash: snapshot.blockHash, facets: structuredClone(snapshot.facets),
    codehashes: { ...snapshot.codehashes, [diamond.toLowerCase()]: keccak256(snapshot.code) } });
}

/** Mere block advance is allowed; routing, code and observed owner must still match the pinned origin. */
export function checkUpgradeBaseline(origin: UpgradeOrigin, snapshot: DiamondSnapshot): Result<UpgradeBaseline, string> {
  const baseline = upgradeBaseline(snapshot, origin.address);
  if (!baseline.ok) return baseline;
  const delta = buildUpgradeCuts({ diamond: origin.address, current: origin.facets, desired: baseline.value.facets, locked: [] });
  const current = new Map(Object.entries(baseline.value.codehashes).map(([address, hash]) => [address.toLowerCase(), hash.toLowerCase()]));
  if (!delta.ok || delta.value.length > 0 || Object.entries(origin.codehashes).some(([address, hash]) => current.get(address.toLowerCase()) !== hash.toLowerCase())
    || (origin.owner?.toLowerCase() ?? null) !== (snapshot.owner?.toLowerCase() ?? null)) {
    return err("The diamond's routing, runtime code or owner changed since this plan was imported. Inspect it again and create a fresh upgrade plan.");
  }
  return baseline;
}

function requirements(project: Project, catalog: Catalog, plan: UpgradePlan): Result<UpgradeCode[], string> {
  const result = new Map<string, UpgradeCode>();
  const releaseByName = (name: string) => catalog.libraries?.find((library) => library.name === name)?.release
    ?? catalog.facets.find((facet) => facet.name === name)?.release
    ?? catalog.inits.find((init) => init.name === name || init.contract === name)?.release;
  const add = (label: string, address: Address, codehash: Hex, dependencies: readonly string[] = []): string | null => {
    const key = address.toLowerCase();
    const previous = result.get(key);
    if (previous !== undefined) return previous.codehash.toLowerCase() === codehash.toLowerCase() ? null : "The plan expects conflicting runtime code at one address.";
    result.set(key, { label, address, codehash });
    for (const name of dependencies) {
      const release = releaseByName(name);
      if (!release) return `The pinned catalog has no runtime release for required library ${name}.`;
      const error = add(name, release.address, release.codehash, release.dependsOn);
      if (error !== null) return error;
    }
    return null;
  };
  for (const entry of plan.analysis.plan) {
    const instance = project.recipe.facetInstances?.[entry.facet];
    const metadata = catalog.facets.find((facet) => facet.name === (instance?.kind === "known" ? instance.catalogFacet : entry.facet));
    const error = add(entry.facet, entry.address, entry.codehash, metadata?.release.dependsOn);
    if (error !== null) return err(error);
  }
  const init = planInit(project.recipe, catalog);
  const names = [...init.steps.map((step) => step.spec), ...(init.steps.length > 1 ? ["MultiInit"] : [])];
  for (const name of names) {
    const release = releaseByName(name);
    if (!release) return err(`The requested initializer ${name} has no pinned runtime release.`);
    const error = add(name, release.address, release.codehash, release.dependsOn);
    if (error !== null) return err(error);
  }
  return ok([...result.values()]);
}

/** Hash-pinned reads of code not already authenticated by the snapshot, with at most four in flight. */
export async function checkUpgradeCode(target: InspectionTarget, snapshot: DiamondSnapshot, required: readonly UpgradeCode[], ports: UpgradePreflightPorts, signal?: AbortSignal): Promise<Result<void, string>> {
  const observed = upgradeBaseline(snapshot, target.address);
  if (!observed.ok) return observed;
  let next = 0;
  let failure: string | null = null;
  const worker = async () => {
    while (next < required.length && failure === null && !signal?.aborted) {
      const expected = required[next++]!;
      const known = observed.value.codehashes[expected.address.toLowerCase()];
      if (known !== undefined) {
        if (known.toLowerCase() !== expected.codehash.toLowerCase()) failure = `The runtime code for ${expected.label} differs from the plan.`;
        continue;
      }
      try {
        const read = await ports.codeAt(target.chainId, expected.address, snapshot.blockHash);
        if (!read.ok || !isHexAnyCase(read.value) || read.value === "0x" || keccak256(read.value).toLowerCase() !== expected.codehash.toLowerCase()) {
          failure ??= `The required runtime code for ${expected.label} is missing, unreadable or different. Deploy the correct shared contract before reviewing this cut.`;
        }
      } catch { failure ??= `The required runtime code for ${expected.label} couldn't be checked.`; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(required.length, 4) }, worker));
  if (signal?.aborted) return err("Upgrade preflight was canceled.");
  return failure === null ? ok(undefined) : err(failure);
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

/** Captures a pure plan and fresh on-chain facts, without writing a record, exporting or asking a wallet. */
export async function prepareUpgrade(args: { project: Project; catalog: Catalog; from: Address; context?: AnalysisContext; acks?: readonly string[]; signal?: AbortSignal }, ports: UpgradePreflightPorts): Promise<Result<PreparedUpgrade, string>> {
  const project = structuredClone(args.project);
  const origin = project.upgrade;
  if (project.recipe.mode !== "upgrade" || !origin || !isAddress(args.from)) return err("Open an upgrade plan and connect its intended sender before review.");
  const target = { chainId: origin.chainId, address: origin.address };
  const from = args.from;
  const unconfirmed = Object.entries(project.provenance).filter(([, source]) => source === "file" || source === "link").map(([path]) => path);
  const context: AnalysisContext = { known: project.predicted.map((entry) => entry.address), ...args.context,
    unconfirmed: [...new Set([...unconfirmed, ...(args.context?.unconfirmed ?? [])])], refs: { self: origin.address, deployer: from } };
  const planned = planUpgrade(project.recipe, args.catalog, origin, context);
  if (!planned.ok) return planned;
  const blocker = planned.value.analysis.problems.find((problem) => problem.severity === "blocker");
  if (blocker) return err(blocker.message);
  const unacknowledged = planned.value.analysis.problems.find((problem) => problem.ack && !(args.acks ?? []).includes(problem.id));
  if (unacknowledged) return err(`Acknowledge this plan warning before upgrading: ${unacknowledged.message}`);
  const initPlan = planInit(project.recipe, args.catalog);
  const init = encodeInit(initPlan, args.catalog, { self: origin.address, deployer: from });
  if (!init.ok) return init;
  if (planned.value.cuts.length === 0 && init.value.data === "0x") return err("This plan has no routing changes or explicit initializer to execute.");
  try {
    const [read, catalogs] = await Promise.all([ports.inspect(target, args.signal ?? new AbortController().signal), ports.catalogs()]);
    if (args.signal?.aborted) return err("Upgrade preflight was canceled.");
    if (!read.ok) return err(read.error.reason);
    if (!catalogs.ok) return catalogs;
    if (catalogs.value.length === 0 || !catalogs.value.some((catalog) => catalog.hash.toLowerCase() === args.catalog.hash.toLowerCase())) return err("The upgrade plan's verified catalog is unavailable.");
    const same = checkUpgradeBaseline(origin, read.value);
    if (!same.ok) return same;
    const required = requirements(project, args.catalog, planned.value);
    if (!required.ok) return required;
    const code = await checkUpgradeCode(target, read.value, required.value, ports, args.signal);
    if (!code.ok) return code;
    const authority = await readUpgradeAuthority(target, read.value, catalogs.value, from, ports.call);
    if (!authority.ok) return authority;
    const resolved = resolveUpgrade(project.recipe, args.catalog);
    if (!resolved.ok) return resolved;
    const opaque = resolved.value.raw.map((row) => ({ kind: row.kind, address: row.address, codehash: row.codehash, selectors: row.selectors,
      label: row.kind === "self" ? "Diamond itself" : row.kind === "foreign" ? "Unknown facet" : "Known facet with raw extra selectors" }));
    const newKnown = planned.value.analysis.plan.some((entry) => project.recipe.facetInstances?.[entry.facet] === undefined);
    const tx: TxRequest = { to: origin.address, value: 0n, data: encodeFunctionData({ abi: UPGRADE_ABI, functionName: "diamondCut", args: [planned.value.cuts, init.value.target, init.value.data] }) };
    const details: UpgradeReviewDetails = { projectId: project.id, chainId: origin.chainId, chainName: ports.chainName(origin.chainId), diamond: origin.address, from,
      recipeHash: planned.value.analysis.recipeHash, catalogHash: args.catalog.hash, baselineBlock: origin.block, observedBlock: read.value.block, cuts: planned.value.cuts,
      init: { ...init.value, steps: initPlan.steps.map((step) => step.spec) }, authority: authority.value, opaque,
      requiresOpaqueAcknowledgement: opaque.length > 0 && (newKnown || init.value.data !== "0x") };
    return ok(freeze(structuredClone({ project, catalog: args.catalog, from, snapshot: read.value, plan: planned.value, tx, authority: authority.value, requiredCode: required.value, details })));
  } catch { return err("The upgrade couldn't be prepared. Retry the chain and catalog checks."); }
}
