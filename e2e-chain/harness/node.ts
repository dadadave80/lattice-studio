/**
 * One local Anvil node per test file, started through prool and stopped in `afterAll`. The node is only ever
 * local: a fork reads a remote RPC, but every transaction goes to this node.
 */
import { Instance } from "prool";
import {
  createTestClient, defineChain, http, publicActions, walletActions, type Address, type Hex,
} from "viem";

/** Anvil's default account 0 and 1 (its well-known dev mnemonic); the nodes keep them unlocked. */
export const ALICE: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const BOB: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

export type NodeOptions = {
  port: number;
  chainId?: number;
  /** Fork this RPC (read-only upstream); the fork's own transactions stay on the local node. */
  forkUrl?: string;
  forkBlockNumber?: bigint;
};

function makeClient(url: string, chainId: number) {
  const chain = defineChain({
    id: chainId,
    name: `Anvil ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  });
  // Anvil mines on arrival: poll receipts every 25 ms, not viem's 4 s default for a chain without a block time.
  return createTestClient({ mode: "anvil", chain, transport: http(url, { timeout: 60_000 }), pollingInterval: 25 })
    .extend(publicActions)
    .extend(walletActions);
}

export type Client = ReturnType<typeof makeClient>;

export type Node = {
  url: string;
  chainId: number;
  client: Client;
  /** Raw JSON-RPC, for revert bytes viem would otherwise wrap in an error class. */
  rpc: <T>(method: string, params: unknown[]) => Promise<T>;
  /** `eth_call` that returns the revert data instead of throwing: `{ ok, data }`. */
  call: (tx: { from?: Address; to: Address; data: Hex; gas?: bigint }) => Promise<{ ok: boolean; data: Hex }>;
  stop: () => Promise<void>;
};

export async function startNode(options: NodeOptions): Promise<Node> {
  const chainId = options.chainId ?? 31337;
  const instance = Instance.anvil({
    port: options.port,
    host: "127.0.0.1",
    ...(options.forkUrl === undefined ? { chainId } : { forkUrl: options.forkUrl }),
    ...(options.forkBlockNumber === undefined ? {} : { forkBlockNumber: options.forkBlockNumber }),
  });
  await instance.start();
  const url = `http://127.0.0.1:${options.port}`;
  let id = 0;
  const rpc = async <T>(method: string, params: unknown[]): Promise<T> => {
    id += 1;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const body = (await response.json()) as { result?: T; error?: { message: string; data?: unknown } };
    if (body.error) {
      const error = new Error(`${method}: ${body.error.message}`) as Error & { data?: unknown };
      error.data = body.error.data;
      throw error;
    }
    return body.result as T;
  };
  const call: Node["call"] = async (tx) => {
    const params = { from: tx.from ?? ALICE, to: tx.to, data: tx.data, ...(tx.gas === undefined ? {} : { gas: `0x${tx.gas.toString(16)}` }) };
    try {
      return { ok: true, data: await rpc<Hex>("eth_call", [params, "latest"]) };
    } catch (error) {
      const data = (error as { data?: unknown }).data;
      if (typeof data === "string" && data.startsWith("0x")) return { ok: false, data: data as Hex };
      if (/revert/i.test((error as Error).message)) return { ok: false, data: "0x" };
      throw error;
    }
  };
  const actualChainId = Number(BigInt(await rpc<Hex>("eth_chainId", [])));
  return {
    url,
    chainId: actualChainId,
    client: makeClient(url, actualChainId),
    rpc,
    call,
    stop: async () => {
      await instance.stop();
    },
  };
}

/** Sends from an unlocked account and waits for the receipt; throws when the transaction reverts. */
export async function send(node: Node, tx: { from?: Address; to: Address; data: Hex; gas?: bigint }) {
  const hash = await node.client.sendTransaction({
    account: tx.from ?? ALICE,
    to: tx.to,
    data: tx.data,
    ...(tx.gas === undefined ? {} : { gas: tx.gas }),
    chain: node.client.chain,
  });
  const receipt = await node.client.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error(`transaction ${hash} to ${tx.to} reverted`);
  return receipt;
}
