/**
 * Read-only readiness probes for `--chain` (spec L842, L921): one viem public client, JSON-RPC batched, no
 * wallet, no transaction. It fills the parts of `ChainState` the NET checks read: Arachnid's proxy, CreateX on
 * that path, Multicall3, every shared contract the recipe needs, whether the predicted address already has code,
 * `eth_simulateV1` support, the block gas limit as the per-transaction cap, and the code at every literal
 * address in the init (AUTH-01's single-key check and INIT-01's chain rules). Registry records aren't read, so
 * NET-08 stays quiet (a probe that wasn't made claims nothing).
 */
import {
  type Address,
  ARACHNID_PROXY,
  type Arg,
  type Catalog,
  type ChainState,
  CREATEX,
  type DeployPath,
  type Hex,
  MULTICALL3,
  planInit,
  type Recipe,
  type SharedContract,
  toChecksum,
} from "@lattice-studio/core";
import { createPublicClient, http, keccak256, type Transport } from "viem";
import * as viemChains from "viem/chains";
import { errorMessage } from "./failure";

type ViemChain = { id: number; name: string; rpcUrls: { default: { http: readonly string[] } } };

const KNOWN_CHAINS: ViemChain[] = Object.values(viemChains as Record<string, unknown>).filter(
  (value): value is ViemChain => typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "number" && typeof (value as { name?: unknown }).name === "string",
);

/** Preferred names where several viem chains share an id (31337 is Anvil, Hardhat and Foundry). */
const PREFERRED: Record<number, string> = { 31337: "Anvil", 1: "Ethereum" };

/** The chain's display name ("Sepolia"), else "Chain <id>" (C5a's wording for a chain it can't name). */
export function chainName(chainId: number): string {
  const preferred = PREFERRED[chainId];
  if (preferred !== undefined) return preferred;
  return KNOWN_CHAINS.find((chain) => chain.id === chainId)?.name ?? `Chain ${chainId}`;
}

/** The chain's first public RPC in viem's list, if viem knows the chain. */
export function defaultRpc(chainId: number): string | undefined {
  return KNOWN_CHAINS.find((chain) => chain.id === chainId)?.rpcUrls.default.http[0];
}

/** Shared contracts by the name `ChainState.shared` keys them with (the NET checks' names). */
export function sharedToProbe(recipe: Recipe, catalog: Catalog, chainId: number): Map<string, Address> {
  const out = new Map<string, Address>();
  const own = catalog.chains.find((entry) => entry.chainId === chainId)?.factory;
  out.set("LatticeRegistry", catalog.registry.address);
  out.set("LatticeFactory", own?.address ?? catalog.factory.address);
  const releases: { name: string; release: SharedContract }[] = [];
  for (const name of recipe.facets) {
    const facet = catalog.facets.find((candidate) => candidate.name === name);
    if (facet) releases.push({ name: facet.name, release: facet.release });
  }
  const steps = planInit(recipe, catalog).steps;
  const specs = steps.map((step) => catalog.inits.find((init) => init.name === step.spec));
  if (steps.length >= 2) specs.push(catalog.inits.find((init) => init.contract === "MultiInit"));
  for (const spec of specs) if (spec?.release) releases.push({ name: spec.contract, release: spec.release });
  const byName = (name: string): SharedContract | undefined =>
    catalog.libraries?.find((library) => library.name === name)?.release ??
    catalog.facets.find((facet) => facet.name === name)?.release ??
    catalog.inits.find((init) => init.contract === name)?.release;
  for (const { release } of releases) {
    for (const dependency of release.dependsOn ?? []) {
      const found = byName(dependency);
      if (found) out.set(dependency, found.address);
    }
  }
  for (const { name, release } of releases) out.set(name, release.address);
  return out;
}

function literalAddresses(value: Arg, out: Set<string>): void {
  if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) out.add(value.toLowerCase());
  } else if (Array.isArray(value)) {
    for (const item of value) literalAddresses(item, out);
  } else if (typeof value === "object" && value !== null && !("$ref" in value)) {
    for (const item of Object.values(value)) literalAddresses(item, out);
  }
}

/** Every literal address in the init arguments, lowercase. */
export function initAddresses(recipe: Recipe): string[] {
  const out = new Set<string>();
  const { init } = recipe;
  if (init.kind === "bundle") literalAddresses(init.args, out);
  if (init.kind === "steps") for (const step of init.steps) literalAddresses(step.args, out);
  return [...out].sort();
}

export type ProbeArgs = {
  chainId: number;
  transport: Transport;
  catalog: Catalog;
  recipe: Recipe;
  path: DeployPath;
  /** The diamond's predicted address and the deploying account. */
  predicted: Address;
  deployer: Address;
  now: () => number;
};

export type ProbeResult = { state: ChainState; note?: string };

const codehashOf = (code: Hex | undefined): { present: boolean; codehash?: Hex } =>
  code === undefined || code === "0x" ? { present: false } : { present: true, codehash: keccak256(code) };

/**
 * Probes the chain. An RPC that answers for another chain is an error; one that can't be reached gives an
 * offline `ChainState` (the NET checks then say nothing) and a note saying why.
 */
export async function probeChain(args: ProbeArgs): Promise<{ ok: true; value: ProbeResult } | { ok: false; error: string }> {
  const { chainId, catalog, recipe, path, predicted, deployer, now } = args;
  const name = chainName(chainId);
  const client = createPublicClient({ transport: args.transport });
  const probedAt = (): string => new Date(now()).toISOString();
  let reported: number;
  try {
    reported = await client.getChainId();
  } catch (error) {
    return {
      ok: true,
      value: {
        state: { chainId, name, online: false, probedAt: probedAt(), deployer: { present: false }, shared: {}, simulate: false, codeAt: {} },
        note: `Couldn't reach ${name} (${chainId}): ${firstLine(errorMessage(error))} Checked without readiness.`,
      },
    };
  }
  if (reported !== chainId) return { ok: false, error: `The RPC serves chain ${reported}, not ${chainId}. Pass an RPC for ${name}.` };

  try {
    const code = (address: Address): Promise<Hex | undefined> => client.getCode({ address });
    const shared = sharedToProbe(recipe, catalog, chainId);
    const holders = [...new Set([...initAddresses(recipe), deployer.toLowerCase()])];
    const [arachnid, createx, multicall3, predictedCode, sharedCodes, holderCodes, block, simulate] = await Promise.all([
      code(ARACHNID_PROXY),
      path === "createx" ? code(CREATEX) : Promise.resolve(undefined),
      code(MULTICALL3),
      code(predicted),
      Promise.all([...shared.values()].map((address) => code(address))),
      Promise.all(holders.map((address) => code(toChecksum(address)))),
      client.getBlock(),
      supportsSimulate(client),
    ]);
    const names = [...shared.keys()];
    const state: ChainState = {
      chainId,
      name,
      online: true,
      probedAt: probedAt(),
      deployer: codehashOf(arachnid),
      ...(path === "createx" ? { createx: codehashOf(createx) } : {}),
      multicall3: codehashOf(multicall3),
      shared: Object.fromEntries(names.map((key, i) => [key, codehashOf(sharedCodes[i])])),
      simulate,
      gasCap: block.gasLimit.toString(),
      codeAt: Object.fromEntries(holders.map((address, i) => [address, holderCodes[i] ?? "0x"])),
      predictedHasCode: (predictedCode ?? "0x") !== "0x",
    };
    return { ok: true, value: { state } };
  } catch (error) {
    return { ok: false, error: `Reading ${name} (${chainId}) failed: ${firstLine(errorMessage(error))}` };
  }
}

async function supportsSimulate(client: ReturnType<typeof createPublicClient>): Promise<boolean> {
  try {
    await client.request({ method: "eth_simulateV1", params: [{ blockStateCalls: [{ calls: [] }] }, "latest"] } as never);
    return true;
  } catch {
    return false;
  }
}

/** viem's messages run to several lines of details; the first says what happened. */
function firstLine(text: string): string {
  const line = (text.split("\n")[0] ?? "").trim();
  return /[.!?]$/.test(line) ? line : `${line}.`;
}

/** The default transport: viem's HTTP transport with JSON-RPC batching. The URL is never printed. */
export function httpTransport(url: string): Transport {
  return http(url, { batch: true, retryCount: 1, timeout: 15_000 });
}
