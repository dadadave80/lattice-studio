import { concat, encodeFunctionData, keccak256 } from "viem";
import { ARACHNID_PROXY, arachnidAddress } from "../address";
import type { BuildMissingDeploysFn } from "../model/api";
import type { Catalog, SharedContract } from "../model/catalog";
import type { ChainState, MissingDeploysArgs, TxRequest } from "../model/chain";
import { isHexAnyCase, sameAddress, type Hex } from "../model/hex";
import { err, ok, type Result } from "../model/result";
import { MULTICALL3, MULTICALL3_ABI } from "./abi";

/**
 * Gas Multicall3 spends per `aggregate3` entry on top of the call itself: the loop, the cold CALL to Arachnid's
 * proxy, copying calldata in and the 20-byte result out. Generous on purpose; a batch that doesn't fit costs a
 * failed transaction, a smaller batch costs nothing.
 */
export const MULTICALL3_CALL_OVERHEAD = 10_000n;

/** A shared contract to deploy, by the name the caller used, and the names it was also asked as. */
type Item = { name: string; aliases: string[]; release: SharedContract };

/**
 * The shared contract a name stands for: LatticeRegistry, LatticeFactory, a linked library, a facet, or an init
 * contract by its catalog name or its contract name (DiamondIntrospectionInit's two entry points are one contract).
 * Init contracts deployed per diamond (`ctorArgs`) have no release and aren't shared.
 */
function resolve(catalog: Catalog, name: string): Item | undefined {
  if (name === "LatticeRegistry") return { name, aliases: [name], release: catalog.registry };
  if (name === "LatticeFactory") return { name, aliases: [name], release: catalog.factory };
  const library = catalog.libraries?.find((candidate) => candidate.name === name);
  if (library !== undefined) return { name, aliases: [name], release: library.release };
  const facet = catalog.facets.find((candidate) => candidate.name === name);
  if (facet !== undefined) return { name, aliases: [name], release: facet.release };
  const init = catalog.inits.find((candidate) => candidate.name === name) ?? catalog.inits.find((candidate) => candidate.contract === name);
  if (init?.release !== undefined) return { name, aliases: [...new Set([name, init.name, init.contract])], release: init.release };
  return undefined;
}

function presentOn(chain: ChainState, item: Item): boolean {
  return item.aliases.some((alias) => chain.shared[alias]?.present === true);
}

/**
 * The names in the order they must deploy: each contract's `dependsOn` first (PoseidonT3 before Semaphore and
 * ShieldedPool), otherwise the order given. Anything the chain already has is left out and listed in `skipped`, and
 * a dependency the chain lacks is added even when `names` doesn't list it. Two names for one contract deploy once.
 */
function order(args: MissingDeploysArgs): Result<{ items: Item[]; skipped: string[] }, string> {
  const items: Item[] = [];
  const skipped: string[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (name: string, dependent?: string): Result<null, string> => {
    const item = resolve(args.catalog, name);
    if (item === undefined) {
      return err(dependent === undefined
        ? `${name} isn't a shared contract in catalog ${args.catalog.lattice.tag}.`
        : `${dependent} depends on ${name}, which catalog ${args.catalog.lattice.tag} doesn't release.`);
    }
    const key = item.release.address.toLowerCase();
    if (done.has(key)) return ok(null);
    if (visiting.has(key)) return err(`${name}'s dependencies form a cycle. Rebuild the catalog.`);
    if (presentOn(args.chain, item)) {
      done.add(key);
      skipped.push(name);
      return ok(null);
    }
    visiting.add(key);
    for (const dependency of item.release.dependsOn ?? []) {
      const visited = visit(dependency, name);
      if (!visited.ok) return visited;
    }
    visiting.delete(key);
    done.add(key);
    items.push(item);
    return ok(null);
  };
  for (const name of args.names) {
    const visited = visit(name);
    if (!visited.ok) return visited;
  }
  return ok({ items, skipped });
}

/**
 * `salt ‖ creationCode`, the whole calldata Arachnid's proxy takes (spec R21): it CREATE2s with that salt and
 * returns the new address as 20 raw bytes, not ABI-encoded. The creation code must hash to the release's
 * `initCodeHash`, and the release address must be where CREATE2 puts it, or the contract would land elsewhere.
 */
function arachnidCall(item: Item, code: MissingDeploysArgs["code"], tag: string): Result<Hex, string> {
  const bytes = item.aliases.map((alias) => code[alias]).find((value) => value !== undefined);
  if (bytes === undefined) return err(`${item.name}'s creation code isn't loaded. Reload the catalog.`);
  if (!isHexAnyCase(bytes) || keccak256(bytes) !== item.release.initCodeHash.toLowerCase()) {
    return err(`${item.name}'s creation code doesn't match catalog ${tag}'s init code hash. Reload the catalog.`);
  }
  if (!sameAddress(arachnidAddress(item.release.salt, item.release.initCodeHash), item.release.address)) {
    return err(`${item.name}'s release address isn't where Arachnid's proxy would deploy it. Rebuild the catalog.`);
  }
  return ok(concat([item.release.salt, bytes]).toLowerCase() as Hex);
}

/**
 * The gas a Multicall3 batch of these single-transaction estimates needs: their sum (each still carries the
 * 21,000 intrinsic gas the batch pays once), plus one sixty-third of each for the extra call level EIP-150 holds
 * back, plus `MULTICALL3_CALL_OVERHEAD` per entry.
 */
export function multicallGas(estimates: readonly bigint[]): bigint {
  return estimates.reduce((total, gas) => total + gas + (gas + 62n) / 63n + MULTICALL3_CALL_OVERHEAD, 0n);
}

/**
 * Consecutive groups under the cap, in deploy order, so a dependency never lands in a later batch than its
 * dependent. Without a cap everything is one group. A contract with no estimate, or one that alone passes the
 * cap, goes in a group of its own: nothing proves it fits beside others.
 */
function pack(items: readonly Item[], gas: MissingDeploysArgs["gas"], cap: bigint | undefined): Item[][] {
  if (cap === undefined) return items.length === 0 ? [] : [[...items]];
  const groups: Item[][] = [];
  let current: Item[] = [];
  let estimates: bigint[] = [];
  const close = () => {
    if (current.length > 0) groups.push(current);
    current = [];
    estimates = [];
  };
  for (const item of items) {
    const estimate = gas?.[item.name];
    if (estimate === undefined || multicallGas([estimate]) > cap) {
      close();
      groups.push([item]);
      continue;
    }
    if (multicallGas([...estimates, estimate]) > cap) close();
    current.push(item);
    estimates.push(estimate);
  }
  close();
  return groups;
}

function arachnidTx(data: Hex): TxRequest {
  return { to: ARACHNID_PROXY, data, value: 0n };
}

/**
 * Transactions that put the chain's missing shared contracts at their release addresses through Arachnid's
 * proxy (spec decision 6, Flow 12 step 3, R21). Any account can send them.
 *
 * - **multicall**, when the chain module found Multicall3's canonical codehash (spec L842): `aggregate3` with
 *   `allowFailure` on every entry, so one failed contract doesn't undo the others, split into consecutive batches
 *   whose `multicallGas` stays under `gasCap`. A batch of one goes straight to Arachnid's proxy.
 * - **calls**, when Multicall3 can't be used and the wallet reports EIP-5792 `atomic: supported`: one call per
 *   contract, sent as one `wallet_sendCalls` batch.
 * - **transactions** otherwise: one transaction per contract.
 *
 * A CREATE2 collision at the proxy burns all the gas forwarded to it (EIP-684), so one already-deployed contract
 * would starve its batch. Anything `chain.shared` reports present is left out and listed in `skipped`; the caller
 * probes the chain again right before each send and rebuilds. Dependencies deploy first (`dependsOn`).
 * Errors: an unknown name, missing or mismatched creation code, a catalog address Arachnid wouldn't produce, and a
 * chain without Arachnid's proxy.
 */
export const buildMissingDeploys: BuildMissingDeploysFn = (args) => {
  const ordered = order(args);
  if (!ordered.ok) return ordered;
  const { items, skipped } = ordered.value;
  if (items.length > 0 && !args.chain.deployer.present) {
    return err(`Arachnid's deployment proxy isn't on ${args.chain.name}, so shared contracts can't be deployed there.`);
  }
  const calls = new Map<Item, Hex>();
  for (const item of items) {
    const call = arachnidCall(item, args.code, args.catalog.lattice.tag);
    if (!call.ok) return call;
    calls.set(item, call.value);
  }
  const dataOf = (item: Item): Hex => calls.get(item) ?? "0x";

  if (args.multicall3Canonical && args.chain.multicall3?.present !== false) {
    const groups = pack(items, args.gas, args.gasCap);
    const txs = groups.map((group) => {
      const names = group.map((item) => item.name);
      if (group.length === 1 && group[0] !== undefined) return { tx: arachnidTx(dataOf(group[0])), names };
      const data = encodeFunctionData({
        abi: MULTICALL3_ABI,
        functionName: "aggregate3",
        args: [group.map((item) => ({ target: ARACHNID_PROXY, allowFailure: true, callData: dataOf(item) }))],
      });
      return { tx: { to: MULTICALL3, data, value: 0n }, names };
    });
    const mode = groups.some((group) => group.length > 1) ? "multicall" : "transactions";
    return ok({ mode, txs, skipped });
  }
  const txs = items.map((item) => ({ tx: arachnidTx(dataOf(item)), names: [item.name] }));
  return ok({ mode: args.atomicCalls === true ? "calls" : "transactions", txs, skipped });
};
