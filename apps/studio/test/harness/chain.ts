/**
 * `fakeChainService()`: an in-memory `ChainService` for tests. Every chain is healthy unless the test says
 * otherwise: Arachnid's proxy, Multicall3 and CreateX with their canonical codehashes, every shared contract
 * of the catalog present with its codehash, every pinned registry record listed, and a gas cap. Every call is
 * recorded in `calls`. `install()` puts it behind `chainService()` (renderWithStudio's `chain` option does
 * that for you) and the harness takes it out after the test. Free of Vitest imports.
 */
import type { Address, Catalog, ChainState, Hex, LoupeFacet, Result } from "@lattice-studio/core";
import { CREATEX_CODEHASH, MULTICALL3_CODEHASH } from "@lattice-studio/core";
import { keccak256 } from "viem";
import type { ChainCallError, DiamondCutHistory, DiamondSnapshot } from "@/contracts/chain";
import {
  getCatalog, provideServices, type ChainInfo, type ChainReadiness, type ChainService, type WalletAccount,
  type WalletConnector,
} from "@/contracts";
import { onCleanup } from "./cleanup";

// Core's canonical codehashes, re-exported so tests keep importing them from the harness.
export { CREATEX_CODEHASH, MULTICALL3_CODEHASH };
/** EIP-7825's per-transaction cap. */
export const GAS_CAP = "16777216";

export type FakeChainOptions = {
  chains?: ChainInfo[];
  /** Whose shared contracts and registry records count as present. Default: the loaded catalog at probe time. */
  catalog?: Catalog;
  /** Per chain id: fields that differ from a healthy chain. */
  state?: Record<number, Partial<ChainState>>;
  account?: WalletAccount | null;
  connectors?: WalletConnector[];
  /** Code by address, for `codeAt`. */
  code?: Record<string, Hex | "0x">;
  /** `facets()` by diamond address, for `readFacets`. */
  facets?: Record<string, LoupeFacet[]>;
  /** Explicit coherent on-chain observations, by diamond address. */
  snapshots?: Record<string, DiamondSnapshot>;
  /** Raw call result or failure, keyed by "<lowercase address>:<lowercase calldata>". */
  callResults?: Record<string, Hex | ChainCallError>;
  /** Verified history fixtures by diamond address. Tokens are never part of these facts. */
  history?: Record<string, DiamondCutHistory>;
  /** ENS names → addresses. */
  ens?: Record<string, Address>;
  /** Chain ids whose RPC isn't answering: every read fails with the spec's sentence. */
  down?: number[];
};

export type FakeChainCall = { method: keyof ChainService; args: unknown[] };

export type FakeChain = ChainService & {
  readonly calls: FakeChainCall[];
  setAccount(account: WalletAccount | null): void;
  setState(chainId: number, patch: Partial<ChainState>): void;
  setDown(chainId: number, down: boolean): void;
  /** Announces another wallet, as EIP-6963 does. */
  announceConnector(connector: WalletConnector): void;
  /** Serves it from `chainService()`; returns a disposer (also run after the test). */
  install(): () => void;
};

export const FAKE_CHAINS: readonly ChainInfo[] = [
  { id: 11155111, name: "Sepolia", testnet: true, explorer: "https://sepolia.etherscan.io" },
  { id: 84532, name: "Base Sepolia", testnet: true, explorer: "https://sepolia.basescan.org" },
];

export const FAKE_CONNECTORS: readonly WalletConnector[] = [
  { id: "io.metamask", name: "MetaMask", kind: "injected", rdns: "io.metamask" },
  { id: "walletConnect", name: "Other wallets (QR)", kind: "walletconnect" },
];

const PROBED_AT = "2026-01-01T00:00:00.000Z";

/** A chain where everything Studio probes is present and canonical, for `catalog`'s release. */
export function healthyChainState(chainId: number, name: string, catalog?: Catalog | null): ChainState {
  const shared: ChainState["shared"] = {};
  const records: NonNullable<ChainState["registry"]>["records"] = {};
  if (catalog) {
    shared.LatticeRegistry = { present: true, codehash: catalog.registry.codehash };
    shared.LatticeFactory = { present: true, codehash: catalog.factory.codehash };
    for (const facet of catalog.facets) {
      shared[facet.name] = { present: true, codehash: facet.release.codehash };
      records[`${facet.name}@${facet.release.version}`] = { facet: facet.release.address, codehash: facet.release.codehash };
    }
    for (const library of catalog.libraries ?? []) {
      shared[library.name] = { present: true, codehash: library.release.codehash };
    }
    // Inits by contract and by spec name, as core's missing-contract deploys resolve them.
    for (const init of catalog.inits) {
      if (!init.release) continue;
      shared[init.contract] = { present: true, codehash: init.release.codehash };
      shared[init.name] = { present: true, codehash: init.release.codehash };
    }
  }
  return {
    chainId,
    name,
    online: true,
    probedAt: PROBED_AT,
    deployer: { present: true, codehash: catalog?.deployer.codehash ?? "0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989" },
    createx: { present: true, codehash: CREATEX_CODEHASH },
    multicall3: { present: true, codehash: MULTICALL3_CODEHASH },
    shared,
    registry: { records },
    simulate: true,
    gasCap: GAS_CAP,
    codeAt: {},
  };
}

export function fakeChainService(options: FakeChainOptions = {}): FakeChain {
  const chains = options.chains ?? [...FAKE_CHAINS];
  const patches = new Map<number, Partial<ChainState>>(
    Object.entries(options.state ?? {}).map(([id, patch]) => [Number(id), patch]),
  );
  const lower = <T>(record: Record<string, T> | undefined) =>
    new Map(Object.entries(record ?? {}).map(([a, v]) => [a.toLowerCase(), v]));
  const code = lower(options.code);
  const facets = lower(options.facets);
  const snapshots = lower(options.snapshots);
  const histories = lower(options.history);
  const ens = new Map(Object.entries(options.ens ?? {}));
  const down = new Set(options.down ?? []);
  let account = options.account ?? null;
  let connectors: readonly WalletConnector[] = options.connectors ?? [...FAKE_CONNECTORS];
  const readiness = new Map<number, ChainReadiness>();
  const accountListeners = new Set<(a: WalletAccount | null) => void>();
  const connectorListeners = new Set<(c: readonly WalletConnector[]) => void>();
  const readinessListeners = new Set<(chainId: number) => void>();
  const calls: FakeChainCall[] = [];

  const nameOf = (chainId: number) => chains.find((c) => c.id === chainId)?.name ?? `Chain ${chainId}`;
  const unreachable = (chainId: number) => `${nameOf(chainId)}'s public RPC isn't answering.`;
  const record = (method: keyof ChainService, args: unknown[]) => calls.push({ method, args });
  const fail = <T>(error: string): Result<T, string> => ({ ok: false, error });
  const setReadiness = (chainId: number, next: ChainReadiness) => {
    readiness.set(chainId, next);
    for (const listener of Array.from(readinessListeners)) listener(chainId);
  };
  const subscribe = <T>(set: Set<T>, listener: T) => {
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  };

  const fake: FakeChain = {
    calls,
    chains() {
      record("chains", []);
      return chains;
    },
    async probe(chainId, probeOptions) {
      record("probe", [chainId, probeOptions]);
      setReadiness(chainId, { status: "checking" });
      if (down.has(chainId)) {
        const reason = unreachable(chainId);
        setReadiness(chainId, { status: "error", reason });
        return fail(reason);
      }
      const state = { ...healthyChainState(chainId, nameOf(chainId), options.catalog ?? getCatalog()), ...patches.get(chainId) };
      const codeAt = { ...state.codeAt };
      for (const address of probeOptions?.codeAt ?? []) codeAt[address.toLowerCase()] = code.get(address.toLowerCase()) ?? "0x";
      const value = { ...state, codeAt };
      setReadiness(chainId, { status: "ready", state: value });
      return { ok: true, value };
    },
    readiness: (chainId) => readiness.get(chainId) ?? { status: "unknown" },
    subscribeReadiness: (listener) => subscribe(readinessListeners, listener),
    async codeAt(chainId, address) {
      record("codeAt", [chainId, address]);
      if (down.has(chainId)) return fail(unreachable(chainId));
      return { ok: true, value: code.get(address.toLowerCase()) ?? "0x" };
    },
    async readFacets(chainId, address) {
      record("readFacets", [chainId, address]);
      if (down.has(chainId)) return fail(unreachable(chainId));
      const found = facets.get(address.toLowerCase());
      return found ? { ok: true, value: found } : fail(`There's no diamond at ${address} on ${nameOf(chainId)}.`);
    },
    async inspectDiamond(chainId, address, inspectOptions) {
      record("inspectDiamond", [chainId, address, inspectOptions]);
      if (inspectOptions?.signal?.aborted) return { ok: false, error: { kind: "aborted", reason: "Inspection was cancelled." } };
      if (down.has(chainId)) return { ok: false, error: { kind: "rpc", reason: unreachable(chainId) } };
      const found = snapshots.get(address.toLowerCase());
      if (found) return { ok: true, value: found };
      const rows = facets.get(address.toLowerCase()) ?? null;
      const codehashes: Record<string, Hex> = {};
      for (const row of rows ?? []) {
        const facet = (options.catalog ?? getCatalog())?.facets.find((item) => item.release.address.toLowerCase() === row.facetAddress.toLowerCase());
        codehashes[row.facetAddress.toLowerCase()] = facet?.release.codehash ?? keccak256(code.get(row.facetAddress.toLowerCase()) ?? "0x");
      }
      return { ok: true, value: { block: 1, blockHash: `0x${"ab".repeat(32)}`, code: code.get(address.toLowerCase()) ?? (rows ? "0x6080" : "0x"), facets: rows, codehashes, ownerRouted: false, owner: null } };
    },
    async call(chainId, to, data, callOptions) {
      record("call", [chainId, to, data, callOptions]);
      if (down.has(chainId)) return { ok: false, error: { reason: unreachable(chainId), data: null } };
      const result = options.callResults?.[`${to.toLowerCase()}:${data.toLowerCase()}`] ?? "0x";
      return typeof result === "string" ? { ok: true, value: result } : { ok: false, error: result };
    },
    async cutHistory(chainId, address, historyOptions) {
      record("cutHistory", [chainId, address, { ...historyOptions, ...(historyOptions.token === undefined ? {} : { token: "<redacted>" }) }]);
      if (historyOptions.signal?.aborted) return { ok: false, error: { kind: "aborted", reason: "History read was canceled." } };
      if (down.has(chainId)) return { ok: false, error: { kind: "rpc", reason: unreachable(chainId) } };
      const value = histories.get(address.toLowerCase());
      return value ? { ok: true, value } : { ok: false, error: { kind: "not-read", reason: "History not read: choose a start block or add a HyperRPC token." } };
    },
    async resolveEns(name, chainId) {
      record("resolveEns", [name, chainId]);
      if (down.has(chainId)) return fail(unreachable(chainId));
      return { ok: true, value: ens.get(name) ?? null };
    },
    async reverseEns(address, chainId) {
      record("reverseEns", [address, chainId]);
      if (down.has(chainId)) return fail(unreachable(chainId));
      const hit = [...ens].find(([, a]) => a.toLowerCase() === address.toLowerCase());
      return { ok: true, value: hit ? hit[0] : null };
    },
    connectors: () => connectors,
    subscribeConnectors: (listener) => subscribe(connectorListeners, listener),
    account: () => account,
    subscribeAccount: (listener) => subscribe(accountListeners, listener),
    async connect(connector) {
      record("connect", [connector]);
      if (!account) return fail("No wallet found in this browser.");
      return { ok: true, value: account };
    },
    async disconnect() {
      record("disconnect", []);
      fake.setAccount(null);
    },
    async switchNetwork(chainId) {
      record("switchNetwork", [chainId]);
      if (!account) return fail("No wallet found in this browser.");
      fake.setAccount({ ...account, chainId });
      return { ok: true, value: undefined };
    },
    setAccount(next) {
      account = next;
      for (const listener of Array.from(accountListeners)) listener(account);
    },
    setState(chainId, patch) {
      patches.set(chainId, { ...patches.get(chainId), ...patch });
    },
    setDown(chainId, isDown) {
      if (isDown) down.add(chainId);
      else down.delete(chainId);
    },
    announceConnector(connector) {
      connectors = [...connectors.filter((c) => c.id !== connector.id), connector];
      for (const listener of Array.from(connectorListeners)) listener(connectors);
    },
    install() {
      const dispose = provideServices({ chain: async () => fake });
      onCleanup(dispose);
      return dispose;
    },
  };
  return fake;
}
