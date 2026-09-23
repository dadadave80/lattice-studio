/**
 * @internal For S8a's `bun test` files: an EIP-1193 provider that plays one chain, in memory. It answers the reads
 * the chain module makes (code, balances, blocks, `eth_simulateV1`, the codehash program, Multicall3's
 * `aggregate3`, LatticeRegistry's `get`, a Safe's `getThreshold`/`getOwners`, a diamond's `facets()`, ENS's
 * Universal Resolver) and records every call. Never imported by the app.
 */
import type { Address, Catalog, Hex } from "@lattice-studio/core";
import { MULTICALL3, registryNameHash, packVersion } from "@lattice-studio/core";
import { loadFixtureCatalog } from "@lattice-studio/core/testing";
import {
  custom, decodeFunctionData, encodeAbiParameters, encodeErrorResult, encodeFunctionResult, HttpRequestError, keccak256,
  namehash, numberToHex, parseAbi, type EIP1193RequestFn, type Transport,
} from "viem";
import { ENS_UNIVERSAL_RESOLVER } from "./clients";
import { CODEHASH_PROGRAM, MULTICALL3_CODEHASH, REGISTRY_ABI } from "./probe";

/** Code whose keccak is `MULTICALL3_CODEHASH` isn't available offline, so the mock maps hashes directly. */
export type MockAccount = {
  /** Runtime code; its keccak is the codehash unless `codehash` says otherwise. */
  code?: Hex;
  /** Overrides keccak(code): lets a test put Multicall3's or CreateX's canonical codehash at an address. */
  codehash?: Hex;
  balance?: bigint;
  /** Answers `getThreshold()` and `getOwners()`. */
  safe?: { threshold: bigint; owners: Address[] };
  /** Answers `facets()`. */
  facets?: { facetAddress: Address; functionSelectors: Hex[] }[];
};

export type MockChainOptions = {
  chainId: number;
  accounts?: Record<string, MockAccount>;
  /** LatticeRegistry records by "<Name>@<version>". */
  records?: Record<string, { facet: Address; codehash: Hex }>;
  /** `eth_simulateV1` answers; otherwise "method not found". Default true. */
  simulate?: boolean;
  /** Runs the codehash program; otherwise rejects calls without `to`. Default true. */
  deployless?: boolean;
  gasLimit?: bigint;
  /** ENS forward records: name → coin type (decimal string) → address. */
  ens?: Record<string, Record<string, Address>>;
  /** ENS reverse records: "<lowercase address>:<coin type>" → name. */
  reverse?: Record<string, string>;
};

export type MockCall = { method: string; params: unknown };

export type MockChain = {
  readonly calls: MockCall[];
  /** Every request fails as an unreachable HTTP endpoint would. */
  down: boolean;
  options: MockChainOptions;
  request: EIP1193RequestFn;
  /** A viem transport over this provider, without retries. */
  transport(): Transport;
  /** Methods called so far, in order. */
  methods(): string[];
  reset(): void;
};

const SAFE_ABI = parseAbi(["function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])"]);
const LOUPE_ABI = parseAbi(["function facets() view returns ((address facetAddress, bytes4[] functionSelectors)[])"]);
const MULTICALL_ABI = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
]);
const UR_ABI = parseAbi([
  "function resolveWithGateways(bytes name, bytes data, string[] gateways) view returns (bytes, address)",
  "function reverseWithGateways(bytes lookupAddress, uint256 coinType, string[] gateways) view returns (string, address, address)",
]);
const ADDR_ABI = parseAbi([
  "function addr(bytes32 node) view returns (address)",
  "function addr(bytes32 node, uint256 coinType) view returns (bytes)",
]);

/** A revert as a node reports it: code 3 with the revert data. */
function revert(data: Hex = "0x"): Error {
  return Object.assign(new Error("execution reverted"), { code: 3, data });
}

function rpcError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code });
}

let fixture: Catalog | null = null;

/** K3's fixture catalog. */
export function fixtureCatalog(): Catalog {
  if (fixture) return fixture;
  const loaded = loadFixtureCatalog();
  if (!loaded.ok) throw new Error(loaded.error);
  fixture = loaded.value;
  return fixture;
}

/**
 * Accounts for a chain where everything the catalog releases is deployed with its codehash, plus Arachnid's
 * proxy, Multicall3 and CreateX with their canonical codehashes. `except` leaves names out.
 */
export function healthyAccounts(catalog: Catalog, except: readonly string[] = []): Record<string, MockAccount> {
  const accounts: Record<string, MockAccount> = {
    [catalog.deployer.address.toLowerCase()]: { code: "0x01", codehash: catalog.deployer.codehash },
    [MULTICALL3.toLowerCase()]: { code: "0x02", codehash: MULTICALL3_CODEHASH },
    ["0xba5ed099633d3b313e4d5f7bdc1305d3c28ba5ed"]: {
      code: "0x03",
      codehash: "0xbd8a7ea8cfca7b4e5f5041d7d4b17bc317c5ce42cfbc42066a00cf26b43eb53f",
    },
  };
  const put = (name: string, address: Address, codehash: Hex): void => {
    if (!except.includes(name)) accounts[address.toLowerCase()] = { code: "0x04", codehash };
  };
  put("LatticeRegistry", catalog.registry.address, catalog.registry.codehash);
  put("LatticeFactory", catalog.factory.address, catalog.factory.codehash);
  for (const library of catalog.libraries ?? []) put(library.name, library.release.address, library.release.codehash);
  for (const facet of catalog.facets) put(facet.name, facet.release.address, facet.release.codehash);
  for (const init of catalog.inits) if (init.release) put(init.contract, init.release.address, init.release.codehash);
  return accounts;
}

/** Registry records for every facet of the catalog (its release address and codehash), minus `except`. */
export function listedRecords(catalog: Catalog, except: readonly string[] = []): Record<string, { facet: Address; codehash: Hex }> {
  const records: Record<string, { facet: Address; codehash: Hex }> = {};
  for (const facet of catalog.facets) {
    if (except.includes(facet.name)) continue;
    records[`${facet.name}@${facet.release.version}`] = { facet: facet.release.address, codehash: facet.release.codehash };
  }
  return records;
}

export function mockChain(options: MockChainOptions): MockChain {
  const calls: MockCall[] = [];
  const catalog = fixtureCatalog();

  const account = (address: string): MockAccount | undefined => mock.options.accounts?.[address.toLowerCase()];
  const codehashOf = (address: string): Hex => {
    const found = account(address);
    if (!found?.code || found.code === "0x") return found ? keccak256("0x") : `0x${"00".repeat(32)}`;
    return found.codehash ?? keccak256(found.code);
  };

  /** Records keyed by registry name hash and packed version. */
  const recordKey = (nameHash: Hex, version: bigint): string => `${nameHash.toLowerCase()}:${version}`;
  const records = (): Map<string, { facet: Address; codehash: Hex }> => {
    const out = new Map<string, { facet: Address; codehash: Hex }>();
    for (const [key, record] of Object.entries(mock.options.records ?? {})) {
      const [name = "", version = ""] = key.split("@");
      const packed = packVersion(version);
      if (packed !== null) out.set(recordKey(registryNameHash(name), packed), record);
    }
    return out;
  };

  const ethCall = (to: string | undefined, data: Hex): Hex => {
    if (to === undefined) {
      if (!mock.options.deployless && mock.options.deployless !== undefined) throw rpcError(-32602, "missing to");
      if (!data.startsWith(CODEHASH_PROGRAM)) throw revert();
      const words = data.slice(CODEHASH_PROGRAM.length);
      let out = "0x";
      for (let i = 0; i < words.length; i += 64) out += codehashOf(`0x${words.slice(i + 24, i + 64)}`).slice(2);
      return out as Hex;
    }
    const target = account(to);
    if (!target?.code || target.code === "0x") return "0x";
    const lower = to.toLowerCase();
    if (lower === MULTICALL3.toLowerCase()) {
      const { args } = decodeFunctionData({ abi: MULTICALL_ABI, data });
      const results = args[0].map((call) => {
        try {
          return { success: true, returnData: ethCall(call.target, call.callData) };
        } catch (error) {
          return { success: false, returnData: ((error as { data?: Hex }).data ?? "0x") };
        }
      });
      return encodeFunctionResult({ abi: MULTICALL_ABI, functionName: "aggregate3", result: results });
    }
    if (lower === catalog.registry.address.toLowerCase()) {
      const { args } = decodeFunctionData({ abi: REGISTRY_ABI, data });
      const [nameHash, version] = args;
      const record = records().get(recordKey(nameHash, version));
      if (!record) {
        throw revert(encodeErrorResult({ abi: REGISTRY_ABI, errorName: "LatticeRegistry__RecordNotFound", args: [nameHash, version] }));
      }
      return encodeFunctionResult({
        abi: REGISTRY_ABI,
        functionName: "get",
        result: { facet: record.facet, version, registeredAt: 1, codehash: record.codehash, selectorsHash: `0x${"11".repeat(32)}` },
      });
    }
    if (lower === ENS_UNIVERSAL_RESOLVER) {
      const decoded = decodeFunctionData({ abi: UR_ABI, data });
      if (decoded.functionName === "resolveWithGateways") {
        const inner = decodeFunctionData({ abi: ADDR_ABI, data: decoded.args[1] });
        const node = inner.args[0];
        const coinType = inner.args.length > 1 ? String(inner.args[1]) : "60";
        const name = Object.keys(mock.options.ens ?? {}).find((n) => namehash(n) === node);
        const address = name ? mock.options.ens?.[name]?.[coinType] : undefined;
        const result = inner.args.length > 1
          ? encodeAbiParameters([{ type: "bytes" }], [address ?? "0x"])
          : encodeAbiParameters([{ type: "address" }], [address ?? `0x${"00".repeat(20)}`]);
        return encodeFunctionResult({ abi: UR_ABI, functionName: "resolveWithGateways", result: [result, ENS_UNIVERSAL_RESOLVER] });
      }
      const [lookup, coinType] = decoded.args;
      const name = mock.options.reverse?.[`${lookup.toLowerCase()}:${coinType}`] ?? "";
      const zero = `0x${"00".repeat(20)}` as const;
      return encodeFunctionResult({ abi: UR_ABI, functionName: "reverseWithGateways", result: [name, zero, zero] });
    }
    if (target.safe) {
      const decoded = decodeFunctionData({ abi: SAFE_ABI, data });
      return decoded.functionName === "getThreshold"
        ? encodeFunctionResult({ abi: SAFE_ABI, functionName: "getThreshold", result: target.safe.threshold })
        : encodeFunctionResult({ abi: SAFE_ABI, functionName: "getOwners", result: target.safe.owners });
    }
    if (target.facets) {
      decodeFunctionData({ abi: LOUPE_ABI, data });
      return encodeFunctionResult({ abi: LOUPE_ABI, functionName: "facets", result: target.facets });
    }
    throw revert();
  };

  const answer = (method: string, params: readonly unknown[]): unknown => {
    switch (method) {
      case "eth_chainId":
        return numberToHex(mock.options.chainId);
      case "eth_blockNumber":
        return "0x10";
      case "eth_getCode":
        return account(String(params[0]))?.code ?? "0x";
      case "eth_getBalance":
        return numberToHex(account(String(params[0]))?.balance ?? 0n);
      case "eth_getBlockByNumber":
        return {
          number: "0x10",
          hash: `0x${"ab".repeat(32)}`,
          parentHash: `0x${"cd".repeat(32)}`,
          timestamp: "0x1",
          gasLimit: numberToHex(mock.options.gasLimit ?? 30_000_000n),
          gasUsed: "0x0",
          baseFeePerGas: "0x1",
          miner: `0x${"00".repeat(20)}`,
          transactions: [],
          uncles: [],
        };
      case "eth_simulateV1":
        if (mock.options.simulate === false) throw rpcError(-32601, "the method eth_simulateV1 does not exist/is not available");
        return [{ number: "0x11", calls: [{ status: "0x1", returnData: "0x", gasUsed: "0x5208", logs: [] }] }];
      case "eth_call": {
        const [call] = params as [{ to?: string; data?: Hex; input?: Hex }];
        return ethCall(call.to, call.data ?? call.input ?? "0x");
      }
      default:
        throw rpcError(-32601, `the method ${method} does not exist/is not available`);
    }
  };

  const mock: MockChain = {
    calls,
    down: false,
    options,
    request: (async ({ method, params }: { method: string; params?: unknown }) => {
      calls.push({ method, params });
      if (mock.down) throw new HttpRequestError({ url: "https://rpc.test", status: 503, details: "Service Unavailable" });
      return answer(method, (params ?? []) as unknown[]);
    }) as EIP1193RequestFn,
    transport: () => custom({ request: mock.request }, { retryCount: 0 }),
    methods: () => calls.map((call) => call.method),
    reset: () => {
      calls.length = 0;
    },
  };
  return mock;
}
