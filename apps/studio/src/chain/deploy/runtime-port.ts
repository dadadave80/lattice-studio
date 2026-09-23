/**
 * The app's chain port: the lazy chain module (S8a's `ChainRuntime`) for reads, each chain's viem client for
 * simulation and receipts, and the connected wallet through wagmi's config for sending (spec decision 13). Loaded with
 * the deploy chunk, only once something deploys.
 */
import type { Address } from "@lattice-studio/core";
import { getCapabilities, sendCalls, sendTransaction, waitForCallsStatus, type Config } from "@wagmi/core";
import { loadChainRuntime } from "../infra";
import type { ChainRuntime } from "../infra";
import type { CallsOutcome, DeployChainPort } from "./ports";
import { createViemPort, isRejection, reason, type DeployWallet } from "./viem-port";

const NO_WALLET_SUPPORT = "Wallet support isn't available.";

/** The connected wallet, through wagmi. Every failure is an outcome: a rejection, or its short message. */
export function wagmiWallet(config: Config | null): DeployWallet {
  return {
    async send(chainId, { from, tx }) {
      if (!config) return { kind: "error", message: NO_WALLET_SUPPORT };
      try {
        const hash = await sendTransaction(config, { account: from, chainId, to: tx.to, data: tx.data, value: tx.value });
        return { kind: "sent", value: hash };
      } catch (error) {
        return isRejection(error) ? { kind: "rejected" } : { kind: "error", message: reason(error) };
      }
    },
    async atomicBatch(chainId, from: Address) {
      if (!config) return false;
      try {
        const capabilities = await getCapabilities(config, { account: from, chainId });
        return capabilities.atomic?.status === "supported";
      } catch {
        return false;
      }
    },
    async sendCalls(chainId, { from, calls }) {
      if (!config) return { kind: "error", message: NO_WALLET_SUPPORT };
      try {
        const result = await sendCalls(config, {
          account: from, chainId, forceAtomic: true, calls: calls.map((call) => ({ to: call.to, data: call.data, value: call.value })),
        });
        return { kind: "sent", value: result.id };
      } catch (error) {
        return isRejection(error) ? { kind: "rejected" } : { kind: "error", message: reason(error) };
      }
    },
    async waitCalls(_chainId, id, signal): Promise<CallsOutcome> {
      if (!config) return { kind: "error", message: NO_WALLET_SUPPORT };
      try {
        const result = await waitForCallsStatus(config, { id, timeout: 0 });
        if (signal.aborted) return { kind: "aborted" };
        return {
          kind: "done",
          status: result.status === "success" ? "success" : "failure",
          receipts: (result.receipts ?? []).map((receipt) => ({
            hash: receipt.transactionHash, status: receipt.status, block: Number(receipt.blockNumber),
          })),
        };
      } catch (error) {
        return { kind: "error", message: reason(error) };
      }
    },
  };
}

export function runtimePortOf(runtime: ChainRuntime): DeployChainPort {
  return createViemPort({
    service: runtime,
    client: (chainId) => runtime.publicClient(chainId),
    wallet: wagmiWallet(runtime.wagmi),
    noteEstimate: (chainId, gas) => runtime.noteEstimate(chainId, gas),
  });
}

let port: Promise<DeployChainPort> | null = null;

/** The port over the app's chain module, built once. A failed load is tried again on the next call. */
export function runtimePort(): Promise<DeployChainPort> {
  port ??= loadChainRuntime().then(runtimePortOf, (error: unknown) => {
    port = null;
    throw error;
  });
  return port;
}
