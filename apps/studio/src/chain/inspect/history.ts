import { isAddress, isHexAnyCase, sameAddress, sortCuts, toChecksum, type Address, type Catalog, type Hex, type PassportCutAction, type PassportCutEvent, type Result } from "@lattice-studio/core";
import { numberToHex } from "viem";
import { getBlock, getChainId } from "viem/actions";
import type { CutHistoryOptions, DiamondCutHistory, HistoryReadError } from "@/contracts/chain";
import type { ChainClient } from "../infra/clients";
import { verifyHistoryDeployment } from "./history-deployment";
import { decodeDiamondCutLog, DIAMOND_CUT_TOPIC } from "./history-codec";

const TOPIC = DIAMOND_CUT_TOPIC;
const HASH = /^0x[\da-f]{64}$/i;
const ACTIONS: readonly PassportCutAction[] = ["add", "replace", "remove"];
export type HistoryReadConfig = {
  source?: "rpc" | "hyperrpc";
  initialWindow?: number;
  maxRequests?: number;
  maxLogs?: number;
  maxHeaders?: number;
  catalogs?: readonly Catalog[];
  loadCatalogs?(): Promise<readonly Catalog[]>;
  proofClient?: ChainClient;
};
type ObservedCut = { event: PassportCutEvent; blockHash: Hex; data: Hex; fingerprint: string };
const failure = (kind: HistoryReadError["kind"], reason: string): Result<never, HistoryReadError> => ({ ok: false, error: { kind, reason: `History not read: ${reason}` } });
const stopped = () => failure("aborted", "the read was canceled.");

function quantity(value: unknown): number | null {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][\da-f]*)$/i.test(value)) return null;
  const number = BigInt(value);
  return number <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(number) : null;
}

function parseLog(raw: unknown, address: Address, from: number, to: number): Result<ObservedCut, HistoryReadError> {
  if (raw === null || typeof raw !== "object") return failure("invalid", "the RPC returned a malformed log.");
  const log = raw as Record<string, unknown>;
  const block = quantity(log.blockNumber); const index = quantity(log.logIndex); const txIndex = quantity(log.transactionIndex);
  if (!isAddress(log.address) || !sameAddress(log.address, address) || block === null || index === null || txIndex === null
    || block < from || block > to || log.removed !== false || typeof log.blockHash !== "string" || !HASH.test(log.blockHash)
    || typeof log.transactionHash !== "string" || !HASH.test(log.transactionHash) || !isHexAnyCase(log.data)
    || !Array.isArray(log.topics) || log.topics.length !== 1 || typeof log.topics[0] !== "string" || log.topics[0].toLowerCase() !== TOPIC.toLowerCase()) {
    return failure("invalid", "the RPC returned an invalid, removed or out-of-range cut log.");
  }
  try {
    const decoded = decodeDiamondCutLog({ address: log.address, data: log.data, topics: [log.topics[0] as Hex] }, address);
    if (!decoded.ok) return failure("invalid", "a cut log contains malformed event data.");
    const event: PassportCutEvent = {
      block, logIndex: index, txHash: log.transactionHash.toLowerCase() as Hex, init: decoded.value.init,
      cuts: decoded.value.cuts.map((cut) => ({ facet: cut.facetAddress, action: ACTIONS[cut.action] ?? "unknown", selectors: cut.functionSelectors })),
    };
    const blockHash = log.blockHash.toLowerCase() as Hex;
    return { ok: true, value: { event, blockHash, data: log.data, fingerprint: JSON.stringify([blockHash, event.txHash, txIndex, log.data.toLowerCase(), TOPIC]) } };
  } catch { return failure("invalid", "a cut log contains malformed event data."); }
}

/** Only range/response limits justify smaller windows; authentication and transport failures do not. */
function rangeLimit(error: unknown): boolean {
  const text = error instanceof Error ? error.message : "";
  if (/429|rate.?limit|unauthori[sz]ed|forbidden|401|403/i.test(text)) return false;
  return /block.?range|too many|more than|limit exceeded|response size|query returned/i.test(text);
}

/** An exact requested window, or an explicit failure. Never turns a partial scan into full-history claims. */
export async function readCutHistory(
  client: ChainClient, address: Address, options: CutHistoryOptions, config: HistoryReadConfig = {},
): Promise<Result<DiamondCutHistory, HistoryReadError>> {
  const source = config.source ?? "rpc";
  const unavailable = (stage: string) => failure("rpc", source === "hyperrpc"
    ? `HyperRPC couldn't ${stage}. Check that the token has HyperRPC access, then retry.`
    : `the RPC couldn't ${stage}. Retry or choose a narrower range.`);
  const fromBlock = options.fromBlock ?? (source === "hyperrpc" ? 0 : undefined);
  if (!isAddress(address) || !Number.isSafeInteger(options.toBlock) || options.toBlock < 0 || !HASH.test(options.blockHash)
    || (fromBlock !== undefined && (!Number.isSafeInteger(fromBlock) || fromBlock < 0 || fromBlock > options.toBlock))) {
    return failure("invalid", "enter valid start/end blocks and the inspected block hash.");
  }
  if (fromBlock === undefined) return failure("not-read", "choose a start block, or use HyperRPC with a token.");
  if (options.signal?.aborted) return stopped();
  const maxRequests = config.maxRequests ?? 512; const maxLogs = config.maxLogs ?? 100_000; const maxHeaders = config.maxHeaders ?? 2048;
  let window = config.initialWindow ?? (source === "hyperrpc" ? options.toBlock - fromBlock + 1 : 10_000);
  if (![maxRequests, maxLogs, maxHeaders, window].every((limit) => Number.isSafeInteger(limit) && limit > 0)) return failure("invalid", "the history read limits are invalid.");
  const canonical = async (number: number, hash: Hex): Promise<boolean> => {
    const block = await getBlock(client, { blockNumber: BigInt(number) });
    return block.number === BigInt(number) && block.hash?.toLowerCase() === hash.toLowerCase();
  };
  try {
    if (await getChainId(client) !== client.chain.id) return failure("invalid", "the RPC serves a different chain.");
    if (options.signal?.aborted) return stopped();
    if (!await canonical(options.toBlock, options.blockHash)) return failure("reorg", "the inspected block is no longer canonical. Refresh inspection.");
    const observed = new Map<string, ObservedCut>();
    let start = fromBlock; let requests = 0;
    while (start <= options.toBlock) {
      if (options.signal?.aborted) return stopped();
      if (++requests > maxRequests) return failure("limit", "the request limit was reached. Choose a later start block.");
      const end = start + Math.min(window, options.toBlock - start + 1) - 1;
      let logs: unknown;
      try {
        // Raw logs preserve malformed matches; viem's event-filtering helper can silently drop undecodable logs.
        logs = await client.request({ method: "eth_getLogs", params: [{ address: toChecksum(address), topics: [TOPIC], fromBlock: numberToHex(start), toBlock: numberToHex(end) }] });
      } catch (error) {
        if (options.signal?.aborted) return stopped();
        if (end > start && rangeLimit(error)) { window = Math.max(1, Math.floor(Math.min(window, end - start + 1) / 2)); continue; }
        return unavailable("finish the log scan");
      }
      if (options.signal?.aborted) return stopped();
      if (!Array.isArray(logs)) return failure("invalid", "the RPC didn't return a log list.");
      for (const raw of logs as readonly unknown[]) {
        const parsed = parseLog(raw, address, start, end);
        if (!parsed.ok) return parsed;
        const key = `${parsed.value.event.block}:${parsed.value.event.logIndex}`;
        const previous = observed.get(key);
        if (previous && previous.fingerprint !== parsed.value.fingerprint) return failure("invalid", "the RPC returned conflicting logs at the same position.");
        observed.set(key, parsed.value);
        if (observed.size > maxLogs) return failure("limit", "too many cut events were returned. Choose a later start block.");
      }
      start = end + 1;
    }
    const hashes = new Map<number, Hex>();
    for (const cut of observed.values()) {
      const previous = hashes.get(cut.event.block);
      if (previous !== undefined && previous !== cut.blockHash) return failure("reorg", "the logs disagree about their block hashes. Retry history.");
      hashes.set(cut.event.block, cut.blockHash);
    }
    if (hashes.size > maxHeaders) return failure("limit", "too many event blocks need verification. Choose a later start block.");
    const headers = [...hashes]; let next = 0; let changed = false; let headerUnavailable = false;
    await Promise.all(Array.from({ length: Math.min(4, headers.length) }, async () => {
      while (next < headers.length && !changed && !headerUnavailable && !options.signal?.aborted) {
        const [number, hash] = headers[next++]!;
        try { if (!await canonical(number, hash)) changed = true; }
        catch { headerUnavailable = true; }
      }
    }));
    if (options.signal?.aborted) return stopped();
    if (headerUnavailable) return unavailable("verify an event block");
    if (changed) return failure("reorg", "an event block changed while reading. Retry history.");
    const history = sortCuts([...observed.values()].map((cut) => cut.event));
    const first = history[0];
    let catalogs = config.catalogs ?? [];
    if (fromBlock === 0 && first !== undefined && config.loadCatalogs) {
      try { catalogs = await config.loadCatalogs(); } catch { /* Unavailable metadata cannot establish provenance. */ }
    }
    const deployment = fromBlock === 0 && first !== undefined
      ? await verifyHistoryDeployment(config.proofClient ?? client, address, first, hashes.get(first.block)!, catalogs, observed.get(`${first.block}:${first.logIndex}`)!.data, options.signal) : null;
    if (options.signal?.aborted) return stopped();
    if (!await canonical(options.toBlock, options.blockHash) || await getChainId(client) !== client.chain.id) return failure("reorg", "the inspected chain or block changed during history. Refresh inspection.");
    if (options.signal?.aborted) return stopped();
    return { ok: true, value: { chainId: client.chain.id, address: toChecksum(address), history, source, fromBlock, toBlock: options.toBlock, blockHash: options.blockHash.toLowerCase() as Hex, coverage: fromBlock === 0 ? "full" : "range", deployment } };
  } catch { return options.signal?.aborted ? stopped() : unavailable("verify the history blocks"); }
}
