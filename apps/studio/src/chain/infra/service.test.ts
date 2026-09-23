/** The chain service over EIP-1193 mocks: caching, readiness, offline, fallbacks, ENS, the account and the stores it follows. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Address, Catalog } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import type { Config } from "@wagmi/core";
import { doc, provideServices, session, setCatalogStatus, settings, type WalletConnector } from "@/contracts";
import { isolateContracts } from "@/contracts/test-support";
import { BASE_SEPOLIA, SEPOLIA } from "./chains";
import { createClients } from "./clients";
import { CHAIN_CHECKS_NEED_CONNECTION } from "./copy";
import { createChainService, type ChainRuntime } from "./service";
import { fixtureCatalog, healthyAccounts, listedRecords, mockChain, type MockChain } from "./testing";
import type { Wallet, WalletState } from "./wallet";

const catalog: Catalog = fixtureCatalog();
const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const SAFE = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" as Address;
const ME = "0x3333333333333333333333333333333333333333" as Address;

let restore: () => void;
let online = true;
let reported = 0;
const onlineListeners = new Set<(online: boolean) => void>();
let chains: Record<number, MockChain>;
let service: ChainRuntime;

function setOnline(next: boolean): void {
  online = next;
  for (const listener of onlineListeners) listener(next);
}

function start(wallet: Wallet | null = null): ChainRuntime {
  const clients = createClients({
    overrides: () => settings.get().rpc,
    transport: (url) => {
      const chain = Object.values(chains).find((c) => url.includes(String(c.options.chainId))) ?? chains[SEPOLIA.id];
      if (!chain) throw new Error("no mock chain");
      return chain.transport();
    },
    rank: false,
  });
  service = createChainService({ e2e: false, clients, wallet, normalize: async () => (name) => name.toLowerCase() });
  return service;
}

/** Lets the probes' promise chains run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await Bun.sleep(1);
}

beforeEach(() => {
  restore = isolateContracts();
  online = true;
  reported = 0;
  onlineListeners.clear();
  provideServices({
    now: () => NOW,
    connection: {
      isOnline: () => online,
      subscribe(listener) {
        onlineListeners.add(listener);
        return () => onlineListeners.delete(listener);
      },
      reportFailure: () => {
        reported += 1;
      },
    },
  });
  setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
  doc.load(makeProject());
  // Sepolia's mock answers every URL that doesn't name another chain; Base Sepolia's URLs carry its id.
  chains = {
    [SEPOLIA.id]: mockChain({
      chainId: SEPOLIA.id,
      accounts: {
        ...healthyAccounts(catalog),
        [SAFE.toLowerCase()]: { code: "0x6080", safe: { threshold: 1n, owners: [ME] } },
        [ME.toLowerCase()]: { balance: 10n ** 16n },
        "0xeeeeeeee14d718c2b47d9923deab1335e144eeee": { code: "0x01" },
      },
      records: listedRecords(catalog),
      ens: { "alice.eth": { "60": SAFE } },
      reverse: { [`${ME.toLowerCase()}:60`]: "me.eth" },
    }),
  };
});

afterEach(() => {
  service?.dispose();
  restore();
});

describe("probes and readiness", () => {
  test("choosing a chain probes it: checking, then ready with the time from the clock", async () => {
    start();
    const seen: string[] = [];
    service.subscribeReadiness((chainId) => seen.push(`${chainId}:${service.readiness(chainId).status}`));
    session.set({ chainId: SEPOLIA.id });
    await settle();
    expect(seen).toEqual([`${SEPOLIA.id}:checking`, `${SEPOLIA.id}:ready`]);
    const readiness = service.readiness(SEPOLIA.id);
    expect(readiness.status).toBe("ready");
    if (readiness.status !== "ready") return;
    expect(readiness.state.probedAt).toBe("2026-09-23T12:00:00.000Z");
    expect(readiness.state.name).toBe("Sepolia");
    expect(readiness.state.online).toBe(true);
    expect(readiness.state.createx).toBeUndefined();
  });

  test("probes are cached per session; refresh reads again", async () => {
    start();
    const sepolia = chains[SEPOLIA.id];
    const first = await service.probe(SEPOLIA.id);
    expect(first.ok).toBe(true);
    const calls = sepolia?.calls.length ?? 0;
    const second = await service.probe(SEPOLIA.id);
    expect(sepolia?.calls.length).toBe(calls);
    if (!first.ok || !second.ok) throw new Error("both probes succeed");
    expect(second.value).toBe(first.value);
    await service.probe(SEPOLIA.id, { refresh: true });
    expect(sepolia?.calls.length).toBeGreaterThan(calls);
  });

  test("CreateX shows only on the CreateX path, from the same cached probe", async () => {
    start();
    const sepolia = chains[SEPOLIA.id];
    await service.probe(SEPOLIA.id);
    const calls = sepolia?.calls.length ?? 0;
    const createx = await service.probe(SEPOLIA.id, { path: "createx" });
    expect(createx.ok && createx.value.createx).toEqual({ present: true, codehash: "0xbd8a7ea8cfca7b4e5f5041d7d4b17bc317c5ce42cfbc42066a00cf26b43eb53f" });
    expect(sepolia?.calls.length).toBe(calls);
  });

  test("changing the project's path to CreateX re-publishes the selected chain with CreateX", async () => {
    start();
    session.set({ chainId: SEPOLIA.id });
    await settle();
    doc.record("Use CreateX", (p) => ({ project: { ...p, deploy: { ...p.deploy, path: "createx" } }, changed: true, summary: "" }));
    await settle();
    const readiness = service.readiness(SEPOLIA.id);
    expect(readiness.status === "ready" && readiness.state.createx?.present).toBe(true);
  });

  test("code at asked addresses accumulates into the chain state", async () => {
    start();
    await service.probe(SEPOLIA.id);
    const withSafe = await service.probe(SEPOLIA.id, { codeAt: [SAFE] });
    expect(withSafe.ok && withSafe.value.codeAt).toEqual({ [SAFE.toLowerCase()]: "0x6080" });
    const withMe = await service.probe(SEPOLIA.id, { codeAt: [ME] });
    expect(withMe.ok && withMe.value.codeAt).toEqual({ [SAFE.toLowerCase()]: "0x6080", [ME.toLowerCase()]: "0x" });
  });

  test("an RPC that doesn't answer: the spec's words, readiness error, and the connection service hears of it", async () => {
    start();
    const sepolia = chains[SEPOLIA.id];
    if (sepolia) sepolia.down = true;
    const result = await service.probe(SEPOLIA.id);
    expect(result).toEqual({ ok: false, error: "Sepolia's public RPC isn't answering." });
    expect(service.readiness(SEPOLIA.id)).toEqual({ status: "error", reason: "Couldn't read Sepolia: the RPC didn't answer." });
    expect(reported).toBeGreaterThan(0);
  });

  test("offline: no RPC call, and the chain rows say checks need a connection", async () => {
    start();
    await service.probe(SEPOLIA.id);
    const sepolia = chains[SEPOLIA.id];
    const calls = sepolia?.calls.length ?? 0;
    setOnline(false);
    expect(service.readiness(SEPOLIA.id)).toEqual({ status: "error", reason: CHAIN_CHECKS_NEED_CONNECTION });
    expect(await service.probe(SEPOLIA.id, { refresh: true })).toEqual({ ok: false, error: CHAIN_CHECKS_NEED_CONNECTION });
    expect(sepolia?.calls.length).toBe(calls);
  });

  test("back online, the selected chain is read again", async () => {
    start();
    session.set({ chainId: SEPOLIA.id });
    await settle();
    setOnline(false);
    setOnline(true);
    await settle();
    expect(service.readiness(SEPOLIA.id).status).toBe("ready");
  });

  test("a new RPC override drops the cache and reads the selected chain again", async () => {
    chains[BASE_SEPOLIA.id] = mockChain({ chainId: BASE_SEPOLIA.id, accounts: healthyAccounts(catalog) });
    start();
    session.set({ chainId: SEPOLIA.id });
    await settle();
    const sepolia = chains[SEPOLIA.id];
    const calls = sepolia?.calls.length ?? 0;
    settings.set({ rpc: { [SEPOLIA.id]: "https://mine.example/11155111" } });
    await settle();
    expect(sepolia?.calls.length).toBeGreaterThan(calls);
  });

  test("a chain Studio doesn't list, and no catalog yet, say why", async () => {
    start();
    const unknown = await service.probe(5);
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.error).toBe("Studio doesn't deploy to Chain 5. Choose Sepolia or Base Sepolia.");
    setCatalogStatus({ status: "loading" });
    expect(await service.probe(SEPOLIA.id)).toEqual({ ok: false, error: "The catalog hasn't loaded yet." });
  });

  test("the picker lists the v1 testnets", () => {
    start();
    expect(service.chains().map((c) => c.name)).toEqual(["Sepolia", "Base Sepolia"]);
    expect(service.chains()[0]).toMatchObject({ id: 11155111, testnet: true, explorer: "https://sepolia.etherscan.io" });
  });
});

describe("reads", () => {
  test("codeAt and readFacets", async () => {
    const diamond = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
    const facet = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
    const sepolia = chains[SEPOLIA.id];
    if (sepolia?.options.accounts) sepolia.options.accounts[diamond.toLowerCase()] = { code: "0x60", facets: [{ facetAddress: facet, functionSelectors: ["0xa9059cbb"] }] };
    start();
    expect(await service.codeAt(SEPOLIA.id, SAFE)).toEqual({ ok: true, value: "0x6080" });
    expect(await service.readFacets(SEPOLIA.id, diamond)).toEqual({ ok: true, value: [{ facetAddress: facet, functionSelectors: ["0xa9059cbb"] }] });
    expect(await service.readFacets(SEPOLIA.id, ME)).toEqual({ ok: false, error: `There's no diamond at ${ME} on Sepolia.` });
  });

  test("ENS resolves on Sepolia; Base Sepolia names resolve there too; an invalid name says so", async () => {
    start();
    expect(await service.resolveEns("alice.eth", SEPOLIA.id)).toEqual({ ok: true, value: SAFE });
    expect(await service.reverseEns(ME, SEPOLIA.id)).toEqual({ ok: true, value: "me.eth" });
    // Base Sepolia resolves on Sepolia's resolver with its own coin type: alice.eth has none there.
    expect(await service.resolveEns("alice.eth", BASE_SEPOLIA.id)).toEqual({ ok: true, value: null });
    const strict = createChainService({
      e2e: false,
      clients: createClients({ overrides: () => ({}), transport: () => chains[SEPOLIA.id]?.transport() ?? mockChain({ chainId: 1 }).transport(), rank: false }),
      wallet: null,
      normalize: async () => (name) => {
        if (name.includes(" ")) throw new Error("bad");
        return name;
      },
    });
    expect(await strict.resolveEns("not a name", SEPOLIA.id)).toEqual({ ok: false, error: "“not a name” isn't a valid ENS name." });
    strict.dispose();
  });

  test("ENS with Sepolia down says Sepolia isn't answering", async () => {
    start();
    const sepolia = chains[SEPOLIA.id];
    if (sepolia) sepolia.down = true;
    expect(await service.resolveEns("alice.eth", BASE_SEPOLIA.id)).toEqual({ ok: false, error: "Sepolia's public RPC isn't answering." });
  });
});

describe("the wallet account", () => {
  function fakeWallet(initial: WalletState | null = null): Wallet & { set(state: WalletState | null): void; switched: number[] } {
    let state = initial;
    const listeners = new Set<(s: WalletState | null) => void>();
    const connectors: WalletConnector[] = [{ id: "io.metamask", name: "MetaMask", kind: "injected", rdns: "io.metamask" }];
    const wallet = {
      config: {} as Config,
      switched: [] as number[],
      connectors: () => connectors,
      subscribeConnectors: () => () => {},
      state: () => state,
      subscribe(listener: (s: WalletState | null) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async connect() {
        wallet.set({ address: ME, chainId: SEPOLIA.id, connector: "io.metamask" });
        return { ok: true as const, value: { address: ME, chainId: SEPOLIA.id, connector: "io.metamask" } };
      },
      async disconnect() {
        wallet.set(null);
      },
      async switchChain(chainId: number) {
        wallet.switched.push(chainId);
        return { ok: true as const, value: undefined };
      },
      async reconnect() {},
      set(next: WalletState | null) {
        state = next;
        for (const listener of listeners) listener(next);
      },
    };
    return wallet;
  }

  test("shown at once, then its kind, balance and primary name", async () => {
    const wallet = fakeWallet();
    start(wallet);
    const seen: (string | null)[] = [];
    service.subscribeAccount((account) => seen.push(account ? `${account.address}|${account.kind ?? "-"}|${account.balance ?? "-"}|${account.ens ?? "-"}` : null));
    const result = await service.connect();
    expect(result.ok && result.value.address).toBe(ME);
    await settle();
    expect(seen[0]).toBe(`${ME}|-|-|-`);
    expect(seen.at(-1)).toBe(`${ME}|eoa|${10n ** 16n}|me.eth`);
    expect(service.account()).toMatchObject({ address: ME, chainId: SEPOLIA.id, connector: "io.metamask", kind: "eoa" });
  });

  test("a Safe reads as a Safe", async () => {
    const wallet = fakeWallet({ address: SAFE, chainId: SEPOLIA.id, connector: "io.metamask" });
    start(wallet);
    await settle();
    expect(service.account()?.kind).toBe("safe");
  });

  test("switching network asks the wallet with the chain's public RPC; an unknown chain says why", async () => {
    const wallet = fakeWallet({ address: ME, chainId: BASE_SEPOLIA.id, connector: "io.metamask" });
    start(wallet);
    expect(await service.switchNetwork(SEPOLIA.id)).toEqual({ ok: true, value: undefined });
    expect(wallet.switched).toEqual([SEPOLIA.id]);
    expect((await service.switchNetwork(1)).ok).toBe(false);
  });

  test("connectors come from the wallet; without one, only WalletConnect's row", async () => {
    start(fakeWallet());
    expect(service.connectors().map((c) => c.name)).toEqual(["MetaMask"]);
    service.dispose();
    start(null);
    expect(service.connectors()).toEqual([{ id: "walletConnect", name: "Other wallets (QR)", kind: "walletconnect" }]);
  });
});
