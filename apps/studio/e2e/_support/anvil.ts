/**
 * The Anvil kit: a local node on chain 31337, started through prool, that holds what a deploy on Sepolia would find.
 *
 * - CreateX and Multicall3 runtime code etched at their canonical addresses (Q5's vendored files, refused unless
 *   they hash to core's pinned codehashes).
 * - A stand-in Safe at `SAFE` that answers `getThreshold()` (SafeDiamondCut's `_validateSafe` reads it).
 * - The shared contracts the chosen recipes need (default: every v1 recipe), deployed through Arachnid's proxy with
 *   the transactions core's `buildMissingDeploys` builds. Anvil predeploys the proxy at genesis.
 *
 * Local only: the node binds 127.0.0.1 and never forks. Every transaction goes to it, from Anvil's unlocked
 * default accounts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Instance } from "prool";
import {
  createTestClient, defineChain, http, keccak256, publicActions, walletActions, type Address, type Hex,
} from "viem";
import {
  ARACHNID_PROXY, CREATEX, CREATEX_CODEHASH, MULTICALL3, MULTICALL3_CODEHASH, buildMissingDeploys, loadTemplate,
  type Catalog, type ChainState,
} from "@lattice-studio/core";
import { catalog as builtCatalog, creationCode, neededFor, sharedContracts, v1Recipes } from "./catalog.ts";
import { LOOPBACK, VENDOR_DIR, anvilUrl } from "./env.ts";

/** Anvil's chain id, the one the e2e build adds (contracts §5.5). */
export const ANVIL_CHAIN_ID = 31337;

/** Anvil's default accounts 0 and 1 (its well-known dev mnemonic). The app's mock connector uses account 0. */
export const ALICE: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const BOB: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

/** Where the stand-in Safe lives: the address Q5's chain tests use for SafeDiamondCut. */
export const SAFE: Address = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

/**
 * A stand-in Safe's runtime code: returns `threshold` as one word to any call, so `getThreshold()` reads it.
 * PUSH1 t, PUSH1 0, MSTORE, PUSH1 32, PUSH1 0, RETURN.
 */
export function safeMockCode(threshold: number): Hex {
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new RangeError(`A Safe threshold of ${threshold} doesn't fit one byte.`);
  }
  return `0x60${threshold.toString(16).padStart(2, "0")}60005260206000f3`;
}

const VENDORED = [
  { name: "CreateX", address: CREATEX, codehash: CREATEX_CODEHASH, file: "CreateX.runtime.hex" },
  { name: "Multicall3", address: MULTICALL3, codehash: MULTICALL3_CODEHASH, file: "Multicall3.runtime.hex" },
] as const;

/** A vendored runtime, after checking its keccak256 against core's pin. */
export function vendoredCode(name: "CreateX" | "Multicall3"): Hex {
  const item = VENDORED.find((v) => v.name === name);
  if (!item) throw new Error(`${name} isn't vendored.`);
  const code = readFileSync(join(VENDOR_DIR, item.file), "utf8").trim() as Hex;
  const hash = keccak256(code);
  if (hash !== item.codehash) throw new Error(`e2e-chain/vendor/${item.file} hashes to ${hash}, not ${item.codehash}; refusing to etch it.`);
  return code;
}

function clientFor(url: string) {
  const chain = defineChain({
    id: ANVIL_CHAIN_ID,
    name: "Anvil",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  });
  // Anvil mines on arrival: poll receipts every 25 ms, not viem's default for a chain without a block time.
  return createTestClient({ mode: "anvil", chain, transport: http(url), pollingInterval: 25 })
    .extend(publicActions)
    .extend(walletActions);
}

export type AnvilClient = ReturnType<typeof clientFor>;

export type AnvilNode = {
  /** `http://127.0.0.1:<port>`: what the app's Settings → Networks takes for chain 31337. */
  url: string;
  port: number;
  client: AnvilClient;
  /** Raw JSON-RPC. */
  rpc: <T>(method: string, params: unknown[]) => Promise<T>;
  /** The code hash at `address` (`undefined` when it holds no code). */
  codehash: (address: Address) => Promise<Hex | undefined>;
  /** Sends from an unlocked account and waits for the receipt; throws when it reverts. */
  send: (tx: { from?: Address; to: Address; data: Hex }) => Promise<Hex>;
  /** `evm_snapshot`: an id `revert` goes back to. */
  snapshot: () => Promise<Hex>;
  /** `evm_revert` to `id`. A snapshot is used up by reverting to it: take a new one to go back again. */
  revert: (id: Hex) => Promise<void>;
  stop: () => Promise<void>;
};

/** Starts a fresh local node on `port` (chain 31337, never a fork). Stop it with `stop()`. */
export async function startAnvil(port: number): Promise<AnvilNode> {
  const instance = Instance.anvil({ port, host: LOOPBACK, chainId: ANVIL_CHAIN_ID });
  try {
    await instance.start();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!/address already in use/i.test(reason)) throw error;
    throw new Error(`Anvil couldn't bind ${LOOPBACK}:${port}: another process holds it (lsof -nP -iTCP:${port}).`);
  }
  const url = anvilUrl(port);
  const client = clientFor(url);
  let id = 0;
  const rpc = async <T>(method: string, params: unknown[]): Promise<T> => {
    id += 1;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const body = (await response.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result as T;
  };
  const node: AnvilNode = {
    url,
    port,
    client,
    rpc,
    async codehash(address) {
      const code = await rpc<Hex>("eth_getCode", [address, "latest"]);
      return code === "0x" ? undefined : keccak256(code);
    },
    async send(tx) {
      const hash = await client.sendTransaction({ account: tx.from ?? ALICE, to: tx.to, data: tx.data, chain: null });
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
      if (receipt.status !== "success") throw new Error(`Transaction ${hash} to ${tx.to} reverted.`);
      return hash;
    },
    snapshot: () => rpc<Hex>("evm_snapshot", []),
    async revert(snapshot) {
      const ok = await rpc<boolean>("evm_revert", [snapshot]);
      if (!ok) throw new Error(`Anvil couldn't revert to snapshot ${snapshot}.`);
    },
    stop: () => instance.stop(),
  };
  return node;
}

/** CreateX and Multicall3 at their canonical addresses, read back to confirm the codehash. */
export async function etchVendored(node: AnvilNode): Promise<void> {
  for (const item of VENDORED) {
    await node.client.setCode({ address: item.address, bytecode: vendoredCode(item.name) });
    const live = await node.codehash(item.address);
    if (live !== item.codehash) throw new Error(`${item.name} at ${item.address} reads back as ${live ?? "no code"}.`);
  }
}

/** The stand-in Safe at `SAFE` (threshold 2 unless given). */
export async function etchSafe(node: AnvilNode, threshold = 2): Promise<void> {
  await node.client.setCode({ address: SAFE, bytecode: safeMockCode(threshold) });
}

async function probe(node: AnvilNode, address: Address): Promise<{ present: boolean; codehash?: Hex }> {
  const codehash = await node.codehash(address);
  return codehash ? { present: true, codehash } : { present: false };
}

/** What the node holds, in the `ChainState` shape `buildMissingDeploys` reads. */
export async function chainState(node: AnvilNode, from: Catalog): Promise<ChainState> {
  const shared: ChainState["shared"] = {};
  for (const item of sharedContracts(from)) shared[item.name] = await probe(node, item.release.address);
  return {
    chainId: ANVIL_CHAIN_ID,
    name: "Anvil",
    online: true,
    probedAt: "1970-01-01T00:00:00.000Z",
    deployer: await probe(node, ARACHNID_PROXY),
    createx: await probe(node, CREATEX),
    multicall3: await probe(node, MULTICALL3),
    shared,
    simulate: false,
    codeAt: {},
  };
}

/**
 * Deploys `names` (and what they depend on) that the node lacks, one transaction each through Arachnid's proxy.
 * Returns the names it deployed.
 */
export async function deployShared(node: AnvilNode, names: readonly string[], from: Catalog = builtCatalog()): Promise<string[]> {
  const state = await chainState(node, from);
  const all = sharedContracts(from);
  const withDeps = new Set(names);
  for (const item of all) if (names.includes(item.name)) for (const dep of item.release.dependsOn ?? []) withDeps.add(dep);
  const missing = [...withDeps].filter((name) => state.shared[name]?.present !== true);
  if (missing.length === 0) return [];
  const built = buildMissingDeploys({
    catalog: from,
    names: missing,
    chain: state,
    code: creationCode(missing),
    multicall3Canonical: false,
  });
  if (!built.ok) throw new Error(built.error);
  const deployed: string[] = [];
  for (const { tx, names: batch } of built.value.txs) {
    await node.send({ to: tx.to, data: tx.data });
    deployed.push(...batch);
  }
  return deployed;
}

/** The shared contracts `recipes` need (default: every v1 recipe), by catalog name. */
export function sharedFor(recipes: readonly string[] = v1Recipes(), from: Catalog = builtCatalog()): string[] {
  const names = new Set<string>();
  for (const name of recipes) {
    const loaded = loadTemplate(from, name);
    if (!loaded.ok) throw new Error(loaded.error);
    for (const needed of neededFor(loaded.value, from)) names.add(needed);
  }
  return [...names];
}

export type PrepareOptions = {
  /** Recipes whose shared contracts to deploy. Default: every v1 recipe. `[]` deploys none. */
  recipes?: readonly string[];
  /** The stand-in Safe's threshold. */
  safeThreshold?: number;
};

/** Etches CreateX, Multicall3 and the Safe, then deploys the recipes' shared contracts. */
export async function prepareAnvil(node: AnvilNode, options: PrepareOptions = {}): Promise<string[]> {
  await etchVendored(node);
  await etchSafe(node, options.safeThreshold);
  return deployShared(node, sharedFor(options.recipes));
}
