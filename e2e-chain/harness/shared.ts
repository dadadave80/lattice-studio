/**
 * Shared contracts on the node: probing what's there into a `ChainState` (what S8a's chain module produces in the
 * app) and deploying what's missing with the transactions C5c's `buildMissingDeploys` builds, through Arachnid's
 * proxy, batched through Multicall3's `aggregate3` when asked.
 */
import { decodeFunctionResult, keccak256, type Hex } from "viem";
import {
  ARACHNID_PROXY, CREATEX, MULTICALL3, MULTICALL3_ABI, buildMissingDeploys, type Catalog, type ChainState, type MissingDeploys,
} from "@lattice-studio/core";
import { creationCode, sharedContracts } from "./catalog";
import { ALICE, send, type Node } from "./node";
import { MULTICALL3_CODEHASH } from "./vendor";

/** EIP-7825's per-transaction cap, which the NET checks and the Multicall3 batches work under (spec L839). */
export const GAS_CAP = 16_777_216n;

async function probe(node: Node, address: string): Promise<{ present: boolean; codehash?: Hex }> {
  const code = await node.rpc<Hex>("eth_getCode", [address, "latest"]);
  return code === "0x" ? { present: false } : { present: true, codehash: keccak256(code) };
}

/** What the node holds, in the shape the NET checks and `buildMissingDeploys` read. */
export async function chainState(node: Node, catalog: Catalog, name = "Anvil"): Promise<ChainState> {
  const shared: ChainState["shared"] = {};
  for (const item of sharedContracts(catalog)) shared[item.name] = await probe(node, item.release.address);
  // Init contracts are probed under their contract name too, as S8a keys them.
  for (const init of catalog.inits) {
    const release = init.release;
    if (release !== undefined && shared[init.contract] === undefined) shared[init.contract] = await probe(node, release.address);
  }
  const block = await node.client.getBlock();
  return {
    chainId: node.chainId,
    name,
    online: true,
    probedAt: "1970-01-01T00:00:00.000Z",
    deployer: await probe(node, ARACHNID_PROXY),
    createx: await probe(node, CREATEX),
    multicall3: await probe(node, MULTICALL3),
    shared,
    simulate: false,
    gasCap: (block.gasLimit < GAS_CAP ? block.gasLimit : GAS_CAP).toString(),
    codeAt: {},
  };
}

/** The shared contracts among `names` the node doesn't hold. */
export function absent(state: ChainState, names: readonly string[]): string[] {
  return names.filter((name) => state.shared[name]?.present !== true);
}

export type DeployReport = {
  plan: MissingDeploys;
  /** Per transaction: for a Multicall3 batch, each entry's success and returned bytes; else the one address. */
  results: { names: string[]; entries: { success: boolean; returnData: Hex }[] }[];
};

/**
 * Deploys `names` (and anything they depend on) that the node lacks. `multicall` batches through `aggregate3` with
 * per-contract gas from `eth_estimateGas`; otherwise one transaction each. Every batch's results are read with an
 * `eth_call` just before it's sent, so a caller can check what `aggregate3` returned.
 */
export async function deployMissing(node: Node, catalog: Catalog, names: readonly string[], mode: "multicall" | "transactions"): Promise<DeployReport> {
  const state = await chainState(node, catalog);
  const all = sharedContracts(catalog);
  // Dependencies (PoseidonT3) need creation code too, even when `names` doesn't list them.
  const withDeps = new Set(names);
  for (const item of all) if (names.includes(item.name)) for (const dep of item.release.dependsOn ?? []) withDeps.add(dep);
  const code = creationCode([...withDeps]);
  let gas: Record<string, bigint> | undefined;
  if (mode === "multicall") {
    gas = {};
    for (const name of withDeps) {
      const release = all.find((item) => item.name === name)?.release;
      if (release === undefined || state.shared[name]?.present === true) continue;
      const data = `${release.salt}${(code[name] ?? "0x").slice(2)}` as Hex;
      gas[name] = await node.client.estimateGas({ account: ALICE, to: ARACHNID_PROXY, data });
    }
  }
  const multicall3Canonical = state.multicall3?.codehash === MULTICALL3_CODEHASH;
  const built = buildMissingDeploys({
    catalog,
    names: [...names],
    chain: state,
    code,
    multicall3Canonical: mode === "multicall" && multicall3Canonical,
    gasCap: GAS_CAP,
    ...(gas === undefined ? {} : { gas }),
  });
  if (!built.ok) throw new Error(built.error);
  const results: DeployReport["results"] = [];
  for (const { tx, names: batch } of built.value.txs) {
    const preview = await node.call({ to: tx.to, data: tx.data });
    if (tx.to.toLowerCase() === MULTICALL3.toLowerCase()) {
      const entries = decodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", data: preview.data }) as readonly {
        success: boolean;
        returnData: Hex;
      }[];
      results.push({ names: batch, entries: entries.map((e) => ({ success: e.success, returnData: e.returnData })) });
    } else {
      results.push({ names: batch, entries: [{ success: preview.ok, returnData: preview.data }] });
    }
    await send(node, { to: tx.to, data: tx.data, gas: GAS_CAP });
  }
  return { plan: built.value, results };
}
