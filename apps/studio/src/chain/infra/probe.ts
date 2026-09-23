/**
 * Readiness probes (spec L839-L843) → `ChainState` (contracts §3.1), over one viem client whose transport
 * batches JSON-RPC. What it reads:
 *
 * - The runtime codehash at every address a deploy can need: Arachnid's proxy, Multicall3, CreateX, LatticeRegistry,
 *   the chain's LatticeFactory, and every shared contract of the catalog (facets, init contracts, linked libraries).
 *   No RPC method returns a codehash, so one `eth_call` runs a 37-byte program that returns `EXTCODEHASH` for each
 *   address (`CODEHASH_PROGRAM`); where that fails, `eth_getCode` per address, hashed here.
 * - The registry record for each facet's pinned version (`LatticeRegistry.get(nameHash, version)`), through
 *   Multicall3 only when its codehash is canonical (spec L842: its deployer key is compromised), else as
 *   separate batched calls. A `RecordNotFound` revert is `null`, "not listed".
 * - `eth_simulateV1` support, the per-transaction gas cap, and the code at the addresses Studio asked about.
 */
import type { Address, Catalog, ChainState, Hex } from "@lattice-studio/core";
import { ARACHNID_PROXY, CREATEX, MULTICALL3, MULTICALL3_CODEHASH, packVersion, registryNameHash, toChecksum } from "@lattice-studio/core";
import {
  BaseError, concat, ContractFunctionRevertedError, HttpRequestError, keccak256, LimitExceededRpcError, pad, parseAbi,
  TimeoutError,
} from "viem";
import { call, getBlock, getCode, multicall, readContract } from "viem/actions";
import type { ChainClient } from "./clients";

/** CreateX's runtime codehash (NET-01, spec L335): C6's constant. */
export { CREATEX_CODEHASH } from "@lattice-studio/core";

/** Multicall3's canonical runtime codehash at 0xcA11bde05977b3631167028862bE2a173976CA11: core's constant. */
export { MULTICALL3_CODEHASH };

/** `EXTCODEHASH` of an account that exists but has no code: keccak256 of empty bytes. */
export const EMPTY_CODEHASH: Hex = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";

/**
 * Creation code run by `eth_call` (no `to`), followed by 32-byte words holding addresses. It copies the words to
 * memory, replaces each with its `EXTCODEHASH` and returns them: one call instead of one `eth_getCode` (and a
 * download of the whole runtime code) per address.
 *
 *   PUSH2 0x0025 DUP1 CODESIZE SUB DUP1 SWAP2 PUSH1 0 CODECOPY   copy the words after the program to memory 0
 *   PUSH1 0                                                     i = 0
 *   loop: JUMPDEST DUP2 DUP2 LT ISZERO PUSH1 end JUMPI          while i < len
 *     DUP1 MLOAD EXTCODEHASH DUP2 MSTORE                        mem[i] = extcodehash(mem[i])
 *     PUSH1 32 ADD PUSH1 loop JUMP                              i += 32
 *   end: JUMPDEST POP PUSH1 0 RETURN                            return mem[0..len]
 */
export const CODEHASH_PROGRAM: Hex = "0x610025803803809160003960005b818110156020578051" + "3f8152602001600d565b506000f3" as Hex;

/** LatticeRegistry's read surface at the pin (lattice/src/interfaces/ILatticeRegistry.sol). */
export const REGISTRY_ABI = parseAbi([
  "struct Record { address facet; uint64 version; uint48 registeredAt; bytes32 codehash; bytes32 selectorsHash; }",
  "function get(bytes32 nameHash, uint64 version) view returns (Record record)",
  "error LatticeRegistry__RecordNotFound(bytes32 nameHash, uint64 version)",
]);

type Probe = { present: boolean; codehash?: Hex };

export type ProbeInput = {
  chainId: number;
  /** "Sepolia". */
  name: string;
  catalog: Catalog;
  /** The chain's fixed per-transaction cap; without one, the latest block's gasLimit. */
  gasCap?: bigint;
  /** Addresses to read code at (authority holders, Safes). */
  codeAt: readonly Address[];
  /** From the connection service. */
  online: boolean;
  /** ISO time the probe finished. */
  probedAt: () => string;
};

/**
 * The probed chain, CreateX included: the service keeps `createx` only on the CreateX path (contracts §3.1:
 * "probed only on the CreateX path"); the one extra `EXTCODEHASH` costs nothing inside the same call.
 */
export type ProbeResult = ChainState & { createx: Probe };

/** An HTTP status that means the endpoint is down or refusing load, not that it rejected this request. */
function unreachableStatus(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

/**
 * A failure of the connection itself (the RPC down, a timeout, a 5xx), as opposed to a request the RPC answered
 * with a rejection (an HTTP 400, invalid params) or a revert. Only these tell the connection service to re-check.
 */
export function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof BaseError)) return !(error instanceof Error) || error.name === "TypeError";
  return error.walk((e) => e instanceof TimeoutError || (e instanceof HttpRequestError && unreachableStatus(e.status))) !== null;
}

/** The RPC is rate-limiting (JSON-RPC -32005, HTTP 429): stop, don't fan out into more calls. */
export function isRateLimited(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  return error.walk((e) => e instanceof LimitExceededRpcError || (e instanceof HttpRequestError && e.status === 429)) !== null;
}

/** The RPC refused the caller (HTTP 401 or 403: a key missing, expired or not allowed): every other call would too. */
export function isRefused(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  return error.walk((e) => e instanceof HttpRequestError && (e.status === 401 || e.status === 403)) !== null;
}

/** `LatticeRegistry.get` reverted with `RecordNotFound`: the version isn't listed. */
export function isRecordNotFound(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  return error.walk((e) => e instanceof ContractFunctionRevertedError && e.data?.errorName === "LatticeRegistry__RecordNotFound") !== null;
}

function probeOf(hash: Hex | null): Probe {
  return hash === null ? { present: false } : { present: true, codehash: hash };
}

/** `EXTCODEHASH` result → the codehash, or null for no code (no account, or an account without code). */
function codehashOrNull(word: Hex): Hex | null {
  const lower = word.toLowerCase() as Hex;
  if (/^0x0*$/.test(lower) || lower === EMPTY_CODEHASH) return null;
  return lower;
}

/**
 * The runtime codehash at each address (null: no code), in order. Tries the one-call program first; if the RPC
 * rejects a call without `to` (an HTTP 400, invalid params, a revert) or answers oddly, falls back to `eth_getCode`
 * per address. A connection failure, a rate limit or a refusal (HTTP 401, 403) fails instead: fanning out would
 * only make it worse.
 */
export async function readCodehashes(client: ChainClient, addresses: readonly Address[]): Promise<(Hex | null)[]> {
  if (addresses.length === 0) return [];
  try {
    const data = concat([CODEHASH_PROGRAM, ...addresses.map((address) => pad(address.toLowerCase() as Hex, { size: 32 }))]);
    const result = await call(client, { data });
    const out = result.data ?? "0x";
    if (out.length === 2 + 64 * addresses.length) {
      return addresses.map((_, i) => codehashOrNull(`0x${out.slice(2 + 64 * i, 2 + 64 * (i + 1))}`));
    }
  } catch (error) {
    if (isTransportFailure(error) || isRateLimited(error) || isRefused(error)) throw error;
  }
  const codes = await Promise.all(addresses.map((address) => getCode(client, { address })));
  return codes.map((code) => (code === undefined || code === "0x" ? null : keccak256(code)));
}

/** Named addresses to hash, in a stable order, each address once. */
type Target = { names: string[]; address: Address };

function targetsOf(catalog: Catalog, chainId: number): { core: Record<"deployer" | "multicall3" | "createx", Address>; shared: Target[] } {
  const byAddress = new Map<string, Target>();
  const add = (name: string, address: Address): void => {
    const key = address.toLowerCase();
    const found = byAddress.get(key);
    if (found) {
      if (!found.names.includes(name)) found.names.push(name);
    } else byAddress.set(key, { names: [name], address });
  };
  add("LatticeRegistry", catalog.registry.address);
  const ownFactory = catalog.chains.find((release) => release.chainId === chainId)?.factory;
  add("LatticeFactory", ownFactory?.address ?? catalog.factory.address);
  for (const library of catalog.libraries ?? []) add(library.name, library.release.address);
  for (const facet of catalog.facets) add(facet.name, facet.release.address);
  for (const init of catalog.inits) {
    if (!init.release) continue;
    add(init.contract, init.release.address);
    add(init.name, init.release.address);
  }
  return {
    core: { deployer: catalog.deployer.address, multicall3: MULTICALL3, createx: CREATEX },
    shared: [...byAddress.values()],
  };
}

/** "ERC20@0.4.0" → the registry's record, for every facet whose pinned version packs. */
export async function readRegistry(
  client: ChainClient,
  catalog: Catalog,
  viaMulticall: boolean,
): Promise<NonNullable<ChainState["registry"]>["records"]> {
  const entries = catalog.facets
    .map((facet) => ({ key: `${facet.name}@${facet.release.version}`, name: facet.name, version: packVersion(facet.release.version) }))
    .filter((entry): entry is { key: string; name: string; version: bigint } => entry.version !== null);
  const calls = entries.map((entry) => ({
    address: catalog.registry.address,
    abi: REGISTRY_ABI,
    functionName: "get" as const,
    args: [registryNameHash(entry.name), entry.version] as const,
  }));
  type Row = { facet: Address; codehash: Hex } | null;
  const rowOf = (value: { facet: Address; codehash: Hex }): Row => ({ facet: toChecksum(value.facet), codehash: value.codehash.toLowerCase() as Hex });
  let rows: Row[];
  if (viaMulticall) {
    const results = await multicall(client, { contracts: calls, allowFailure: true, multicallAddress: MULTICALL3, batchSize: 16_384 });
    rows = results.map((result) => {
      if (result.status === "success") return rowOf(result.result);
      if (isRecordNotFound(result.error)) return null;
      throw result.error;
    });
  } else {
    rows = await Promise.all(
      calls.map((call) =>
        readContract(client, call).then(rowOf, (error: unknown) => {
          if (isRecordNotFound(error)) return null;
          throw error;
        }),
      ),
    );
  }
  const records: NonNullable<ChainState["registry"]>["records"] = {};
  entries.forEach((entry, i) => {
    records[entry.key] = rows[i] ?? null;
  });
  return records;
}

/**
 * Whether the RPC answers `eth_simulateV1` (NET-07). Only a clear success means yes; anything else the RPC answers
 * (method not found, rejected parameters, HTTP 403 or 405, "not allowed", "not enabled", a rate limit, an error
 * nobody recognizes) means no, which shows NET-07 at Info level (spec L341) and leaves `eth_call` to simulate.
 * Only a connection failure fails the probe.
 */
export async function supportsSimulate(client: ChainClient): Promise<boolean> {
  try {
    await client.request({
      method: "eth_simulateV1",
      params: [{ blockStateCalls: [{ calls: [{ to: ARACHNID_PROXY, data: "0x" }] }] }, "latest"],
    });
    return true;
  } catch (error) {
    if (isTransportFailure(error)) throw error;
    return false;
  }
}

/** The fixed cap where the chain has one (EIP-7825), else the latest block's gasLimit. */
export async function readGasCap(client: ChainClient, fixed: bigint | undefined): Promise<bigint> {
  if (fixed !== undefined) return fixed;
  const block = await getBlock(client, { blockTag: "latest" });
  return block.gasLimit;
}

/** Runtime code at each address, keyed lowercase ("0x" for none). */
export async function readCodeAt(client: ChainClient, addresses: readonly Address[]): Promise<Record<string, Hex | "0x">> {
  const unique = [...new Set(addresses.map((address) => address.toLowerCase() as Address))];
  const codes = await Promise.all(unique.map((address) => getCode(client, { address })));
  const out: Record<string, Hex | "0x"> = {};
  unique.forEach((address, i) => {
    const code = codes[i];
    out[address] = code === undefined || code === "0x" ? "0x" : (code.toLowerCase() as Hex);
  });
  return out;
}

/** Every probe for one chain, as `ChainState` plus CreateX. Throws when the RPC fails. */
export async function probeChain(client: ChainClient, input: ProbeInput): Promise<ProbeResult> {
  const { catalog } = input;
  const { core, shared } = targetsOf(catalog, input.chainId);
  const addresses = [core.deployer, core.multicall3, core.createx, ...shared.map((target) => target.address)];
  const [hashes, simulate, gasCap, codeAt] = await Promise.all([
    readCodehashes(client, addresses),
    supportsSimulate(client),
    readGasCap(client, input.gasCap),
    readCodeAt(client, input.codeAt),
  ]);
  const [deployer = null, multicall3 = null, createx = null, ...rest] = hashes;
  const sharedState: ChainState["shared"] = {};
  shared.forEach((target, i) => {
    for (const name of target.names) sharedState[name] = probeOf(rest[i] ?? null);
  });

  // Only a registry with the catalog's code can be trusted to report records.
  const registry = sharedState.LatticeRegistry;
  const registryOk = registry?.present === true && registry.codehash === catalog.registry.codehash.toLowerCase();
  const multicallOk = multicall3 === MULTICALL3_CODEHASH;
  const records = registryOk ? await readRegistry(client, catalog, multicallOk) : undefined;

  return {
    chainId: input.chainId,
    name: input.name,
    online: input.online,
    probedAt: input.probedAt(),
    deployer: probeOf(deployer),
    createx: probeOf(createx),
    multicall3: probeOf(multicall3),
    shared: sharedState,
    ...(records ? { registry: { records } } : {}),
    simulate,
    gasCap: gasCap.toString(),
    codeAt,
  };
}
