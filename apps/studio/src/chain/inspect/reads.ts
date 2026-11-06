import type { Address, Hex, LoupeFacet, Result } from "@lattice-studio/core";
import { isAddress, isHex4AnyCase, isHexAnyCase, sameAddress, toChecksum } from "@lattice-studio/core";
import { BaseError, ContractFunctionRevertedError, decodeFunctionResult, ExecutionRevertedError, keccak256, parseAbi } from "viem";
import { call, getBlock, getChainId, getCode } from "viem/actions";
import { revertData } from "../deploy/viem-port";
import type { ChainClient } from "../infra/clients";
import type { DiamondSnapshot, SnapshotCallFailure, SnapshotReadError } from "./snapshot";

const ABI = parseAbi([
  "function facets() view returns ((address facetAddress, bytes4[] functionSelectors)[])",
  "function owner() view returns (address)",
]);
const FACETS = "0x7a0ed627";
const OWNER = "0x8da5cb5b";
const ZERO = "0x0000000000000000000000000000000000000000";
const HASH = /^0x[0-9a-fA-F]{64}$/;
const FACET_READERS = 4;

type BlockIdentity = { number: bigint; hash: Hex };
type Pin = { blockHash: Hex; requireCanonical: true };

const invalid = (reason: string): SnapshotReadError => ({ kind: "invalid", reason });
const unavailable = (stage: string): SnapshotReadError => ({ kind: "rpc", reason: `The RPC couldn't finish ${stage}.` });
const aborted = (): SnapshotReadError => ({ kind: "aborted", reason: "Inspection was canceled." });

function blockIdentity(value: { number: bigint | null; hash: Hex | null }): Result<BlockIdentity, SnapshotReadError> {
  if (typeof value.number !== "bigint" || value.number < 0n || value.number > BigInt(Number.MAX_SAFE_INTEGER)
    || typeof value.hash !== "string" || !HASH.test(value.hash)) {
    return { ok: false, error: invalid("The RPC returned an incomplete or invalid snapshot block.") };
  }
  return { ok: true, value: { number: value.number, hash: value.hash.toLowerCase() as Hex } };
}

function reverted(error: unknown): boolean {
  return error instanceof BaseError && error.walk((cause) => cause instanceof ExecutionRevertedError || cause instanceof ContractFunctionRevertedError) !== null;
}

function callFailure(name: string, error: unknown): SnapshotCallFailure {
  const data = revertData(error);
  return { kind: "reverted", reason: `${name} reverted.`, data: data !== null && isHexAnyCase(data) ? data.toLowerCase() as Hex : null };
}

function loupe(value: unknown): Result<LoupeFacet[], SnapshotReadError> {
  if (!Array.isArray(value)) return { ok: false, error: invalid("facets() didn't return a list of facet rows.") };
  const addresses = new Set<string>();
  const selectors = new Set<string>();
  const facets: LoupeFacet[] = [];
  for (const row of value as readonly unknown[]) {
    if (row === null || typeof row !== "object") return { ok: false, error: invalid("facets() returned a malformed facet row.") };
    const fields = row as Record<string, unknown>;
    if (!isAddress(fields.facetAddress) || sameAddress(fields.facetAddress, ZERO)) {
      return { ok: false, error: invalid("facets() returned a zero or invalid facet address.") };
    }
    const address = toChecksum(fields.facetAddress);
    const key = address.toLowerCase();
    if (addresses.has(key)) return { ok: false, error: invalid(`facets() returned ${address} more than once.`) };
    addresses.add(key);
    if (!Array.isArray(fields.functionSelectors) || fields.functionSelectors.length === 0) {
      return { ok: false, error: invalid(`facets() returned no selectors for ${address}.`) };
    }
    const functionSelectors: Hex[] = [];
    for (const raw of fields.functionSelectors as readonly unknown[]) {
      if (!isHex4AnyCase(raw)) return { ok: false, error: invalid("facets() returned a selector that isn't four hex bytes.") };
      const selector = raw.toLowerCase() as Hex;
      if (selectors.has(selector)) return { ok: false, error: invalid(`facets() routes ${selector} more than once.`) };
      selectors.add(selector);
      functionSelectors.push(selector);
    }
    facets.push({ facetAddress: address, functionSelectors });
  }
  return { ok: true, value: facets };
}

async function facetHashes(
  client: ChainClient, facets: readonly LoupeFacet[], diamond: Address, pin: Pin, signal?: AbortSignal,
): Promise<Result<Record<string, Hex>, SnapshotReadError>> {
  const addresses = facets.map((facet) => facet.facetAddress).filter((address) => !sameAddress(address, diamond));
  const hashes: Hex[] = [];
  const state: { next: number; failure: SnapshotReadError | null } = { next: 0, failure: null };
  const worker = async (): Promise<void> => {
    while (state.next < addresses.length && state.failure === null && !signal?.aborted) {
      const index = state.next++;
      const address = addresses[index]!;
      let code: Hex | undefined;
      try {
        code = await getCode(client, { address, ...pin });
      } catch {
        state.failure ??= unavailable(`reading code for facet ${address}`);
        return;
      }
      if (signal?.aborted) return;
      if (!isHexAnyCase(code) || code === "0x") {
        state.failure ??= invalid(`Facet ${address} has no valid runtime code at the snapshot block.`);
        return;
      }
      hashes[index] = keccak256(code);
    }
  };
  await Promise.all(Array.from({ length: Math.min(FACET_READERS, addresses.length) }, worker));
  if (signal?.aborted) return { ok: false, error: aborted() };
  if (state.failure !== null) return { ok: false, error: state.failure };
  return { ok: true, value: Object.fromEntries(addresses.map((address, index) => [address.toLowerCase(), hashes[index]!])) };
}

/**
 * Reads one block's diamond facts through the caller's existing client. EIP-1898 hash pins prevent ranked
 * fallback endpoints from mixing forks; an unsupported hash parameter fails instead of reading latest.
 * Abort stops queued work; requests already handed to the client finish under its own transport timeout.
 */
export async function readDiamondSnapshot(
  client: ChainClient, address: Address, signal?: AbortSignal,
): Promise<Result<DiamondSnapshot, SnapshotReadError>> {
  if (signal?.aborted) return { ok: false, error: aborted() };
  if (!isAddress(address)) return { ok: false, error: invalid("Enter a valid diamond address.") };
  const expected = client.chain?.id;
  if (!Number.isSafeInteger(expected) || expected <= 0) return { ok: false, error: invalid("The inspection client has no valid chain id.") };
  // Loupe and owner facts must come from the chain, not contract-directed HTTP lookups.
  const onchain: ChainClient = { ...client, ccipRead: false };
  const target = toChecksum(address);
  let stage = "checking the chain";
  try {
    const reported = await getChainId(client);
    if (signal?.aborted) return { ok: false, error: aborted() };
    if (reported !== expected) return { ok: false, error: { kind: "chain", reason: `The RPC serves chain ${reported}, not chain ${expected}.` } };
    stage = "reading the snapshot block";
    const started = blockIdentity(await getBlock(client, { blockTag: "latest" }));
    if (signal?.aborted) return { ok: false, error: aborted() };
    if (!started.ok) return started;
    const pin: Pin = { blockHash: started.value.hash, requireCanonical: true };
    stage = "reading diamond code at the snapshot block";
    const rawCode = await getCode(client, { address: target, ...pin });
    if (signal?.aborted) return { ok: false, error: aborted() };
    const code = rawCode === undefined ? "0x" : rawCode;
    if (!isHexAnyCase(code)) return { ok: false, error: invalid("The RPC returned malformed diamond runtime code.") };
    const snapshot: DiamondSnapshot = {
      block: Number(started.value.number), blockHash: pin.blockHash, code: code.toLowerCase() as Hex,
      facets: null, codehashes: {}, ownerRouted: false, owner: null,
    };
    if (code !== "0x") {
      let data: Hex = "0x";
      stage = "reading facets() at the snapshot block";
      try {
        const result = await call(onchain, { to: target, data: FACETS, ...pin });
        const raw = result.data === undefined ? "0x" : result.data;
        if (!isHexAnyCase(raw)) return { ok: false, error: invalid("facets() returned malformed data.") };
        data = raw;
      } catch (error) {
        if (!reverted(error)) throw error;
        snapshot.loupeError = callFailure("facets()", error);
      }
      if (signal?.aborted) return { ok: false, error: aborted() };
      if (snapshot.loupeError === undefined) {
        if (data === "0x") snapshot.loupeError = { kind: "invalid-response", reason: "facets() returned no data.", data };
        else {
          let decoded: unknown;
          try {
            decoded = decodeFunctionResult({ abi: ABI, functionName: "facets", data });
          } catch {
            return { ok: false, error: invalid("facets() returned malformed ABI data.") };
          }
          const parsed = loupe(decoded);
          if (!parsed.ok) return parsed;
          snapshot.facets = parsed.value;
          const hashes = await facetHashes(client, parsed.value, target, pin, signal);
          if (signal?.aborted) return { ok: false, error: aborted() };
          if (!hashes.ok) return hashes;
          snapshot.codehashes = hashes.value;
          snapshot.ownerRouted = parsed.value.some((facet) => facet.functionSelectors.includes(OWNER));
          if (snapshot.ownerRouted) {
            stage = "reading owner() at the snapshot block";
            let ownerData: Hex = "0x";
            try {
              const result = await call(onchain, { to: target, data: OWNER, ...pin });
              const raw = result.data === undefined ? "0x" : result.data;
              if (!isHexAnyCase(raw)) return { ok: false, error: invalid("owner() returned malformed RPC data.") };
              ownerData = raw;
            } catch (error) {
              if (!reverted(error)) throw error;
              snapshot.ownerError = callFailure("owner()", error);
            }
            if (signal?.aborted) return { ok: false, error: aborted() };
            if (snapshot.ownerError === undefined) {
              try {
                const owner = decodeFunctionResult({ abi: ABI, functionName: "owner", data: ownerData });
                if (!isAddress(owner)) throw new Error("Invalid owner.");
                snapshot.owner = toChecksum(owner);
              } catch {
                snapshot.ownerError = { kind: "invalid-response", reason: "owner() returned malformed data.", data: ownerData };
              }
            }
          }
        }
      }
    }
    stage = "verifying the snapshot block";
    const [finishedBlock, finishedChain] = await Promise.all([
      getBlock(client, { blockNumber: started.value.number }), getChainId(client),
    ]);
    if (signal?.aborted) return { ok: false, error: aborted() };
    if (finishedChain !== expected) return { ok: false, error: { kind: "chain", reason: `The RPC serves chain ${finishedChain}, not chain ${expected}.` } };
    const finished = blockIdentity(finishedBlock);
    if (!finished.ok) return finished;
    if (finished.value.number !== started.value.number || finished.value.hash !== started.value.hash) {
      return { ok: false, error: { kind: "reorg", reason: "The snapshot block changed while reading. Retry inspection." } };
    }
    return { ok: true, value: snapshot };
  } catch {
    return { ok: false, error: signal?.aborted ? aborted() : unavailable(stage) };
  }
}
