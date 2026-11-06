import type { Address, Result } from "@lattice-studio/core";
import { createClient, http, type Transport } from "viem";
import type { CutHistoryOptions, DiamondCutHistory, HistoryReadError } from "@/contracts/chain";
import type { ChainClient } from "../infra/clients";
import { readCutHistory, type HistoryReadConfig } from "./history";

// https://docs.envio.dev/docs/HyperSync/hypersync-supported-networks (verified 2026-11-06).
const HYPERRPC = new Set([11155111, 84532, 10143, 43113]);
export function supportsHyperRpc(chainId: number): boolean { return HYPERRPC.has(chainId); }
export type HistoryProviderConfig = HistoryReadConfig & { transport?(url: string, signal?: AbortSignal): Transport };

/** Only four fixed HTTPS hosts receive tokens. No credential is forwarded to a user-configured RPC. */
export async function readHistory(
  client: ChainClient, address: Address, options: CutHistoryOptions, config: HistoryProviderConfig = {},
): Promise<Result<DiamondCutHistory, HistoryReadError>> {
  if (options.token === undefined) return readCutHistory(client, address, options, { ...config, source: "rpc" });
  if (!options.token.trim()) return { ok: false, error: { kind: "not-read", reason: "History not read: add a HyperRPC token, or use an RPC start block." } };
  if (!supportsHyperRpc(client.chain.id)) return { ok: false, error: { kind: "unsupported", reason: "History not read: HyperRPC isn't available for this chain. Use an RPC start block." } };
  const token = options.token.trim();
  if (token.length > 1024 || [...token].some((character) => character.charCodeAt(0) < 33 || character.charCodeAt(0) > 126)) {
    return { ok: false, error: { kind: "invalid", reason: "History not read: enter an API token without spaces or control characters." } };
  }
  try {
    const url = `https://${client.chain.id}.rpc.hypersync.xyz/${encodeURIComponent(token)}`;
    const transport = config.transport?.(url, options.signal) ?? http(url, {
      retryCount: 0, timeout: 15_000,
      fetchOptions: { redirect: "error", referrerPolicy: "no-referrer", ...(options.signal === undefined ? {} : { signal: options.signal }) },
    });
    const provider = createClient({ chain: client.chain, transport, ccipRead: false });
    return await readCutHistory(provider, address, options, { ...config, source: "hyperrpc", proofClient: client });
  } catch { return { ok: false, error: { kind: "rpc", reason: "History not read: HyperRPC couldn't finish the request. Check its token access or retry." } }; }
}
