/**
 * The app's chain port: the lazy chain module (S8a's `ChainRuntime`) for reads, each chain's viem client for
 * simulation and receipts, and the connected wallet for sending. The wallet is reached through the current wagmi
 * connection's EIP-1193 provider, with plain `eth_sendTransaction` and EIP-5792's `wallet_*` methods, so this chunk
 * carries none of wagmi itself: wagmi stays in the chain module (spec L822).
 */
import type { Address, Hex, TxRequest } from "@lattice-studio/core";
import type { Config } from "@wagmi/core";
import { numberToHex } from "viem";
import { chainService } from "@/contracts";
import type { ChainRuntime } from "../infra/service";
import type { CallsOutcome, DeployChainPort } from "./ports";
import { createViemPort, isRejection, reason, type DeployWallet } from "./viem-port";

const NO_WALLET = "Connect a wallet first.";
const CALLS_POLL = 1_000;

export type Eip1193 = { request(args: { method: string; params?: unknown }): Promise<unknown> };

/** The provider of the wallet connected now, or null. */
async function currentProvider(config: Config | null): Promise<Eip1193 | null> {
  if (!config) return null;
  const { current, connections } = config.state;
  const connector = current === null ? undefined : connections.get(current)?.connector;
  if (!connector) return null;
  const provider = (await connector.getProvider()) as Eip1193 | undefined;
  return provider && typeof provider.request === "function" ? provider : null;
}

function call(tx: TxRequest): { to: Address; data: Hex; value: Hex } {
  return { to: tx.to, data: tx.data, value: numberToHex(tx.value) };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}

type CallsStatus = { status?: number | string; receipts?: { transactionHash?: Hex; status?: Hex | string; blockNumber?: Hex | string }[] };

/** The connected wallet over EIP-1193. Every failure is an outcome: a rejection (4001), or its short message. */
export function providerWallet(provider: () => Promise<Eip1193 | null>): DeployWallet {
  return {
    async send(chainId, { from, tx, gas }) {
      const wallet = await provider();
      if (!wallet) return { kind: "error", message: NO_WALLET };
      try {
        // `chainId` binds the request to the reviewed chain: a wallet that switched meanwhile refuses it.
        const hash = await wallet.request({
          method: "eth_sendTransaction",
          params: [{ from, chainId: numberToHex(chainId), ...call(tx), ...(gas === undefined ? {} : { gas: numberToHex(gas) }) }],
        });
        return typeof hash === "string" ? { kind: "sent", value: hash.toLowerCase() as Hex } : { kind: "error", message: "The wallet returned no transaction hash." };
      } catch (error) {
        return isRejection(error) ? { kind: "rejected" } : { kind: "error", message: reason(error) };
      }
    },
    async atomicBatch(chainId, from) {
      const wallet = await provider();
      if (!wallet) return false;
      try {
        const chain = numberToHex(chainId);
        const capabilities = (await wallet.request({ method: "wallet_getCapabilities", params: [from, [chain]] })) as
          Record<string, { atomic?: { status?: string } }> | null;
        return capabilities?.[chain]?.atomic?.status === "supported";
      } catch {
        return false;
      }
    },
    async sendCalls(chainId, { from, calls }) {
      const wallet = await provider();
      if (!wallet) return { kind: "error", message: NO_WALLET };
      try {
        const result = (await wallet.request({
          method: "wallet_sendCalls",
          params: [{ version: "2.0.0", chainId: numberToHex(chainId), from, atomicRequired: true, calls: calls.map(call) }],
        })) as { id?: unknown } | string;
        const id = typeof result === "string" ? result : result.id;
        return typeof id === "string" ? { kind: "sent", value: id } : { kind: "error", message: "The wallet returned no calls id." };
      } catch (error) {
        return isRejection(error) ? { kind: "rejected" } : { kind: "error", message: reason(error) };
      }
    },
    async waitCalls(_chainId, id, signal): Promise<CallsOutcome> {
      const wallet = await provider();
      if (!wallet) return { kind: "error", message: NO_WALLET };
      while (!signal.aborted) {
        try {
          const status = (await wallet.request({ method: "wallet_getCallsStatus", params: [id] })) as CallsStatus;
          const code = Number(status.status ?? 100);
          if (code >= 200) {
            return {
              kind: "done",
              status: code === 200 ? "success" : "failure",
              receipts: (status.receipts ?? []).map((receipt) => ({
                hash: (receipt.transactionHash ?? "0x") as Hex,
                status: Number(receipt.status ?? 0) === 1 ? "success" : "reverted",
                block: Number(receipt.blockNumber ?? 0),
              })),
            };
          }
        } catch (error) {
          return { kind: "error", message: reason(error) };
        }
        await wait(CALLS_POLL, signal);
      }
      return { kind: "aborted" };
    },
  };
}

export function portOf(runtime: ChainRuntime): DeployChainPort {
  return createViemPort({
    service: runtime,
    client: (chainId) => runtime.publicClient(chainId),
    wallet: providerWallet(() => currentProvider(runtime.wagmi)),
    noteEstimate: (chainId, gas) => runtime.noteEstimate(chainId, gas),
  });
}

/**
 * The chain module's full runtime (S8a's `loadChainRuntime`, without its barrel, which would bring the chain table
 * and its copy into a chunk of their own): the service plus each chain's viem client and wagmi's config.
 */
async function loadRuntime(): Promise<ChainRuntime> {
  const service = await chainService();
  if (typeof (service as Partial<ChainRuntime>).publicClient === "function") return service as ChainRuntime;
  throw new Error("The chain service in use has no viem clients (a test fake).");
}

let port: Promise<DeployChainPort> | null = null;

/** The port over the app's chain module, built once. A failed load is tried again on the next call. */
export function appPort(): Promise<DeployChainPort> {
  port ??= loadRuntime().then(portOf, (error: unknown) => {
    port = null;
    throw error;
  });
  return port;
}
