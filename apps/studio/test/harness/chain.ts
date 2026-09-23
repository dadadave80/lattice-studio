/**
 * `fakeChainService()`: an in-memory `ChainService` for tests. Every chain is healthy unless the test says
 * otherwise; every call is recorded in `calls`. `install()` puts it behind `chainService()` (renderWithStudio's
 * `chain` option does that for you) and the harness takes it out after the test.
 */
import type { Address, ChainState, Hex, Result } from "@lattice-studio/core";
import { provideServices, type ChainInfo, type ChainService, type WalletAccount } from "@/contracts";
import { onCleanup } from "./cleanup";

export type FakeChainOptions = {
  chains?: ChainInfo[];
  /** Per chain id: fields that differ from a healthy chain. */
  state?: Record<number, Partial<ChainState>>;
  account?: WalletAccount | null;
  /** Code by lowercase address, for `codeAt`. */
  code?: Record<string, Hex | "0x">;
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
  /** Serves it from `chainService()`; returns a disposer (also run after the test). */
  install(): () => void;
};

export const FAKE_CHAINS: readonly ChainInfo[] = [
  { id: 11155111, name: "Sepolia", testnet: true, explorer: "https://sepolia.etherscan.io" },
  { id: 84532, name: "Base Sepolia", testnet: true, explorer: "https://sepolia.basescan.org" },
];

const PROBED_AT = "2026-01-01T00:00:00.000Z";

/** A chain where everything Studio probes is present. */
export function healthyChainState(chainId: number, name: string): ChainState {
  return {
    chainId,
    name,
    online: true,
    probedAt: PROBED_AT,
    deployer: { present: true },
    shared: {},
    simulate: true,
    codeAt: {},
  };
}

export function fakeChainService(options: FakeChainOptions = {}): FakeChain {
  const chains = options.chains ?? [...FAKE_CHAINS];
  const patches = new Map<number, Partial<ChainState>>(
    Object.entries(options.state ?? {}).map(([id, patch]) => [Number(id), patch]),
  );
  const code = new Map(Object.entries(options.code ?? {}).map(([a, c]) => [a.toLowerCase(), c]));
  const ens = new Map(Object.entries(options.ens ?? {}));
  const down = new Set(options.down ?? []);
  let account = options.account ?? null;
  const accountListeners = new Set<(a: WalletAccount | null) => void>();
  const calls: FakeChainCall[] = [];

  const nameOf = (chainId: number) => chains.find((c) => c.id === chainId)?.name ?? `Chain ${chainId}`;
  const unreachable = (chainId: number) => `${nameOf(chainId)}'s public RPC isn't answering.`;
  const record = (method: keyof ChainService, args: unknown[]) => calls.push({ method, args });
  const fail = <T>(error: string): Result<T, string> => ({ ok: false, error });

  const fake: FakeChain = {
    calls,
    chains() {
      record("chains", []);
      return chains;
    },
    async probe(chainId, probeOptions) {
      record("probe", [chainId, probeOptions]);
      if (down.has(chainId)) return fail(unreachable(chainId));
      const state = { ...healthyChainState(chainId, nameOf(chainId)), ...patches.get(chainId) };
      const codeAt = { ...state.codeAt };
      for (const address of probeOptions?.codeAt ?? []) codeAt[address.toLowerCase()] = code.get(address.toLowerCase()) ?? "0x";
      return { ok: true, value: { ...state, codeAt } };
    },
    async codeAt(chainId, address) {
      record("codeAt", [chainId, address]);
      if (down.has(chainId)) return fail(unreachable(chainId));
      return { ok: true, value: code.get(address.toLowerCase()) ?? "0x" };
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
    account() {
      return account;
    },
    subscribeAccount(listener) {
      accountListeners.add(listener);
      return () => accountListeners.delete(listener);
    },
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
      for (const listener of accountListeners) listener(account);
    },
    setState(chainId, patch) {
      patches.set(chainId, { ...patches.get(chainId), ...patch });
    },
    setDown(chainId, isDown) {
      if (isDown) down.add(chainId);
      else down.delete(chainId);
    },
    install() {
      const dispose = provideServices({ chain: async () => fake });
      onCleanup(dispose);
      return dispose;
    },
  };
  return fake;
}
