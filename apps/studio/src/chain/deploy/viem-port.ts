/**
 * The deploy machine's chain port over viem: reads, simulation (`eth_simulateV1`, else `eth_call` and
 * `eth_estimateGas`), a receipt watcher with replacement detection and no timeout of its own, and a wallet the caller
 * supplies (wagmi's connector in the app, `runtime-port.ts`; Anvil's unlocked accounts in the chain tests). Reads go
 * through each chain's own client, so the person's RPC serves them; the wallet signs through its own.
 */
import type { Address, ChainState, Hex, LoupeFacet, Result, TxRequest } from "@lattice-studio/core";
import { BaseError, type Chain, type Client, type Transport } from "viem";
import {
  call, estimateGas, getBlock, getBlockNumber, getTransaction, getTransactionCount, getTransactionReceipt, simulateBlocks,
} from "viem/actions";
import type { ChainService } from "@/contracts";
import type { CallOutcome, CallsOutcome, DeployChainPort, ReceiptOutcome, SendOutcome, SimulationOutcome, TxStatus } from "./ports";

export type ChainClient = Client<Transport, Chain>;

/** Signs and sends: the connected wallet. Every failure is an outcome, never a throw. */
export type DeployWallet = {
  send(chainId: number, request: { from: Address; tx: TxRequest }): Promise<SendOutcome>;
  atomicBatch(chainId: number, from: Address): Promise<boolean>;
  sendCalls(chainId: number, request: { from: Address; calls: readonly TxRequest[] }): Promise<SendOutcome<string>>;
  waitCalls(chainId: number, id: string, signal: AbortSignal): Promise<CallsOutcome>;
};

export type ViemPortOptions = {
  service: Pick<ChainService, "chains" | "probe" | "codeAt" | "readFacets" | "account">;
  client(chainId: number): ChainClient;
  wallet: DeployWallet;
  noteEstimate(chainId: number, gas: bigint | null): void;
  /** Receipt polling interval in ms (default: the client's). */
  pollInterval?: number;
};

/** How far back the watcher looks for the transaction that took a nonce. */
const REPLACEMENT_SCAN = 64n;

/** The revert bytes inside a viem error, if any. */
export function revertData(error: unknown): Hex | null {
  if (!(error instanceof BaseError)) return null;
  const found = error.walk((e) => typeof (e as { data?: unknown }).data === "string" && String((e as { data: string }).data).startsWith("0x"));
  const data = (found as { data?: unknown } | null)?.data;
  return typeof data === "string" && data.startsWith("0x") ? (data as Hex) : null;
}

/** EIP-1193 4001: the person said no in their wallet. */
export function isRejection(error: unknown): boolean {
  const matches = (e: unknown): boolean => {
    const x = e as { code?: unknown; name?: unknown } | null;
    return x?.code === 4001 || x?.name === "UserRejectedRequestError";
  };
  if (error instanceof BaseError) return error.walk(matches) !== null;
  return matches(error);
}

/** A short sentence for an error, for the review and the console. */
export function reason(error: unknown): string {
  const text = error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : String(error);
  const line = (text.split("\n")[0] ?? "").trim() || "The request failed.";
  return /[.!?]$/.test(line) ? line : `${line}.`;
}

function named(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
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

type SeenTx = { hash: Hex; nonce: number; from: Address; to: Address | null; value: bigint; input: Hex };

export function createViemPort(options: ViemPortOptions): DeployChainPort {
  const { service, wallet } = options;
  const clientOf = (chainId: number): ChainClient => options.client(chainId);
  const nameOf = (chainId: number): string => service.chains().find((c) => c.id === chainId)?.name ?? `Chain ${chainId}`;
  const unreachable = (chainId: number): string => `${nameOf(chainId)}'s public RPC isn't answering.`;

  const seen = async (client: ChainClient, hash: Hex): Promise<SeenTx | null> => {
    try {
      const tx = await getTransaction(client, { hash });
      return { hash: tx.hash, nonce: tx.nonce, from: tx.from, to: tx.to ?? null, value: tx.value, input: tx.input };
    } catch {
      return null;
    }
  };

  /** The transaction that used `nonce` for `from`, looking back from the latest block. */
  const byNonce = async (client: ChainClient, from: Address, nonce: number, since: bigint): Promise<SeenTx | null> => {
    const latest = await getBlockNumber(client, { cacheTime: 0 });
    const floor = latest - since > REPLACEMENT_SCAN ? latest - REPLACEMENT_SCAN : since;
    for (let n = latest; n >= floor; n--) {
      const block = await getBlock(client, { blockNumber: n, includeTransactions: true });
      for (const tx of block.transactions) {
        if (typeof tx === "string") continue;
        if (tx.from.toLowerCase() === from.toLowerCase() && tx.nonce === nonce) {
          return { hash: tx.hash, nonce: tx.nonce, from: tx.from, to: tx.to ?? null, value: tx.value, input: tx.input };
        }
      }
      if (n === 0n) break;
    }
    return null;
  };

  const classify = (original: SeenTx, replacement: SeenTx): "repriced" | "cancelled" | "replaced" => {
    const sameTo = (original.to ?? "").toLowerCase() === (replacement.to ?? "").toLowerCase();
    if (sameTo && original.value === replacement.value && original.input.toLowerCase() === replacement.input.toLowerCase()) return "repriced";
    if ((replacement.to ?? "").toLowerCase() === replacement.from.toLowerCase() && replacement.value === 0n) return "cancelled";
    return "replaced";
  };

  const port: DeployChainPort = {
    chainName: nameOf,
    account() {
      const account = service.account();
      return account ? { address: account.address, chainId: account.chainId } : null;
    },
    probe: (chainId, probeOptions) =>
      service.probe(chainId, {
        ...(probeOptions?.refresh ? { refresh: true } : {}),
        ...(probeOptions?.path ? { path: probeOptions.path } : {}),
        ...(probeOptions?.codeAt ? { codeAt: probeOptions.codeAt } : {}),
      }) as Promise<Result<ChainState, string>>,
    codeAt: (chainId, address) => service.codeAt(chainId, address),
    readFacets: (chainId, address) => service.readFacets(chainId, address) as Promise<Result<LoupeFacet[], string>>,

    async simulate(chainId, { from, tx, simulateV1 }): Promise<SimulationOutcome> {
      const client = clientOf(chainId);
      try {
        if (simulateV1) {
          const [block] = await simulateBlocks(client, {
            blocks: [{ calls: [{ account: from, to: tx.to, data: tx.data, value: tx.value }] }],
            validation: false,
          });
          const result = block?.calls[0];
          const number = Number(block?.number ?? 0n);
          if (!result) return { kind: "error", message: unreachable(chainId) };
          if (result.status === "success") {
            return { kind: "ok", block: number, gas: result.gasUsed, events: result.logs?.length ?? 0, method: "simulate" };
          }
          return { kind: "reverted", block: number, data: result.data, method: "simulate" };
        }
        const blockNumber = await getBlockNumber(client, { cacheTime: 0 });
        try {
          await call(client, { account: from, to: tx.to, data: tx.data, value: tx.value, blockNumber });
        } catch (error) {
          const data = revertData(error);
          if (data !== null || /revert/i.test(reason(error))) return { kind: "reverted", block: Number(blockNumber), data: data ?? "0x", method: "call" };
          throw error;
        }
        const gas = await estimateGas(client, { account: from, to: tx.to, data: tx.data, value: tx.value });
        return { kind: "ok", block: Number(blockNumber), gas, method: "call" };
      } catch (error) {
        const data = revertData(error);
        if (data !== null) return { kind: "reverted", block: 0, data, method: simulateV1 ? "simulate" : "call" };
        return { kind: "error", message: error instanceof BaseError && error.walk((e) => named(e, "HttpRequestError") || named(e, "TimeoutError")) ? unreachable(chainId) : reason(error) };
      }
    },

    async call(chainId, { from, tx, block }): Promise<CallOutcome> {
      try {
        const result = await call(clientOf(chainId), {
          account: from, to: tx.to, data: tx.data, value: tx.value, ...(block === undefined ? {} : { blockNumber: BigInt(block) }),
        });
        return { ok: true, data: result.data ?? "0x" };
      } catch (error) {
        return { ok: false, data: revertData(error), message: reason(error) };
      }
    },

    async replay(chainId, hash) {
      const client = clientOf(chainId);
      try {
        const tx = await getTransaction(client, { hash });
        if (tx.to === null || tx.blockNumber === null) return null;
        await call(client, {
          account: tx.from, to: tx.to, data: tx.input, value: tx.value, blockNumber: tx.blockNumber > 0n ? tx.blockNumber - 1n : 0n,
        });
        return null;
      } catch (error) {
        return revertData(error);
      }
    },

    async estimateGas(chainId, { from, tx }) {
      try {
        return { ok: true, value: await estimateGas(clientOf(chainId), { account: from, to: tx.to, data: tx.data, value: tx.value }) };
      } catch (error) {
        return { ok: false, error: reason(error) };
      }
    },

    noteEstimate: (chainId, gas) => options.noteEstimate(chainId, gas),
    send: (chainId, request) => wallet.send(chainId, request),

    async watch(chainId, hash, { from, signal, onRepriced }): Promise<ReceiptOutcome> {
      const client = clientOf(chainId);
      const interval = options.pollInterval ?? client.pollingInterval;
      let current = hash;
      let known: SeenTx | null = null;
      let since: bigint | null = null;
      while (!signal.aborted) {
        try {
          const receipt = await getTransactionReceipt(client, { hash: current }).catch(() => null);
          if (signal.aborted) break;
          if (receipt) return { kind: "receipt", hash: current, status: receipt.status, block: Number(receipt.blockNumber) };
          since ??= await getBlockNumber(client, { cacheTime: 0 });
          if (!known) {
            known = await seen(client, current);
          } else {
            // Its nonce went to something else: a speed-up (same call), a cancel, or a replacement.
            const nonce = await getTransactionCount(client, { address: from, blockTag: "latest" });
            if (nonce > known.nonce) {
              const replacement = await byNonce(client, known.from, known.nonce, since);
              if (replacement && replacement.hash.toLowerCase() !== current.toLowerCase()) {
                const kind = classify(known, replacement);
                if (kind !== "repriced") return { kind: "replaced", reason: kind, hash: replacement.hash };
                current = replacement.hash;
                known = replacement;
                onRepriced(current);
                continue;
              }
            }
          }
        } catch {
          // A failed poll (the RPC hiccuped, offline): try again next time.
        }
        await sleep(interval, signal);
      }
      return { kind: "aborted" };
    },

    async transactionStatus(chainId, hash): Promise<Result<TxStatus, string>> {
      const client = clientOf(chainId);
      try {
        const tx = await getTransaction(client, { hash });
        return { ok: true, value: tx.blockNumber === null ? "pending" : "mined" };
      } catch (error) {
        if (error instanceof BaseError && error.walk((e) => named(e, "TransactionNotFoundError"))) return { ok: true, value: "unknown" };
        return { ok: false, error: unreachable(chainId) };
      }
    },

    atomicBatch: (chainId, from) => wallet.atomicBatch(chainId, from),
    sendCalls: (chainId, request) => wallet.sendCalls(chainId, request),
    waitCalls: (chainId, id, signal) => wallet.waitCalls(chainId, id, signal),
  };
  return port;
}
