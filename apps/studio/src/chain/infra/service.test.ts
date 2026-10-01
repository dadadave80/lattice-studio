/** The chain service over EIP-1193 mocks: caching, readiness, offline, fallbacks, ENS, the account and the stores it follows. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Address, Catalog } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import type { Config } from "@wagmi/core";
import { doc, provideServices, session, setCatalogStatus, settings, type WalletConnector } from "@/contracts";
import { bufferedServices } from "@/contracts/services";
import { isolateContracts } from "@/contracts/test-support";
import { BASE_SEPOLIA, SEPOLIA } from "./chains";
import { createClients } from "./clients";
import { CHAIN_CHECKS_NEED_CONNECTION } from "./copy";
import { predict } from "@/state/prediction";
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
/** Every RPC URL a transport was made for. */
const urlsCalled = new Set<string>();
const OVERRIDE_WAIT = 20;

function setOnline(next: boolean): void {
  online = next;
  for (const listener of onlineListeners) listener(next);
}

function start(wallet: Wallet | null = null): ChainRuntime {
  const clients = createClients({
    transport: (url) => {
      urlsCalled.add(url);
      const chain = Object.values(chains).find((c) => url.includes(String(c.options.chainId))) ?? chains[SEPOLIA.id];
      if (!chain) throw new Error("no mock chain");
      return chain.transport();
    },
  });
  service = createChainService({
    e2e: false, clients, wallet, rank: false, overrideDelay: OVERRIDE_WAIT, normalize: async () => (name) => name.toLowerCase(),
  });
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
  urlsCalled.clear();
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
    // Debounced: nothing until the override has settled.
    expect(sepolia?.calls.length).toBe(calls);
    await Bun.sleep(OVERRIDE_WAIT + 10);
    await settle();
    expect(sepolia?.calls.length).toBeGreaterThan(calls);
    expect(urlsCalled.has("https://mine.example/11155111")).toBe(true);
  });

  test("a half-typed override is never called: keystrokes settle first, and an invalid URL isn't used", async () => {
    start();
    session.set({ chainId: SEPOLIA.id });
    await settle();
    for (const typed of ["h", "https://", "https://mai", "https://mainnet.example/11155111"]) settings.set({ rpc: { [SEPOLIA.id]: typed } });
    await Bun.sleep(OVERRIDE_WAIT + 10);
    await settle();
    // Only what the person settled on is called; the keystrokes before it never are.
    expect([...urlsCalled].filter((url) => url.includes("mai"))).toEqual(["https://mainnet.example/11155111"]);
    // Something that isn't an http(s) URL is never called, and the console says so once.
    settings.set({ rpc: { [SEPOLIA.id]: "wss://mainnet.example" } });
    await Bun.sleep(OVERRIDE_WAIT + 10);
    await settle();
    settings.set({ rpc: { [SEPOLIA.id]: " wss://mainnet.example" } });
    await Bun.sleep(OVERRIDE_WAIT + 10);
    await service.probe(SEPOLIA.id, { refresh: true });
    expect([...urlsCalled].some((url) => url.startsWith("wss:"))).toBe(false);
    const notes = bufferedServices().log.filter((line) => line.text === "The RPC set for Sepolia isn't an http(s) URL, so Studio uses Sepolia's public RPCs.");
    expect(notes).toHaveLength(1);
  });

  test("a new catalog drops the old one's ready state until the new probe finishes", async () => {
    start();
    session.set({ chainId: SEPOLIA.id });
    await settle();
    expect(service.readiness(SEPOLIA.id).status).toBe("ready");
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sepolia = chains[SEPOLIA.id];
    if (sepolia) sepolia.intercept = () => held;
    setCatalogStatus({ status: "ready", id: "next", catalog: { ...catalog, hash: `0x${"12".repeat(32)}` }, manifest: null });
    await settle();
    expect(service.readiness(SEPOLIA.id).status).toBe("checking");
    if (sepolia) sepolia.intercept = undefined;
    release();
    await Bun.sleep(5);
    await settle();
    expect(service.readiness(SEPOLIA.id).status).toBe("ready");
  });

  test("a Retry's fresh read wins over probes made while it runs", async () => {
    start();
    session.set({ chainId: SEPOLIA.id });
    await settle();
    const sepolia = chains[SEPOLIA.id];
    if (!sepolia?.options.accounts) throw new Error("mock");
    const erc20 = catalog.facets.find((f) => f.name === "ERC20");
    if (!erc20) throw new Error("fixture has ERC20");
    // The chain changed since the last read: ERC20 is gone.
    delete sepolia.options.accounts[erc20.release.address.toLowerCase()];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    sepolia.intercept = () => held;
    const retry = service.probe(SEPOLIA.id, { refresh: true });
    await settle();
    // Re-reading the same chain keeps the last ready state published until the fresh one arrives.
    const stale = service.readiness(SEPOLIA.id);
    expect(stale.status === "ready" && stale.state.shared.ERC20?.present).toBe(true);
    // A path edit or S8b's read while the Retry runs: it joins the fresh read, not the old cache.
    const during = service.probe(SEPOLIA.id);
    await settle();
    expect(service.readiness(SEPOLIA.id)).toBe(stale);
    sepolia.intercept = undefined;
    release();
    const [fresh, joined] = await Promise.all([retry, during]);
    expect(fresh.ok && fresh.value.shared.ERC20?.present).toBe(false);
    expect(joined.ok && joined.value.shared.ERC20?.present).toBe(false);
    const readiness = service.readiness(SEPOLIA.id);
    expect(readiness.status === "ready" && readiness.state.shared.ERC20?.present).toBe(false);
  });

  test("re-reading the chain around each send (missing contracts) stays ready, so NET-03 never drops out and comes back", async () => {
    start();
    session.set({ chainId: SEPOLIA.id });
    await settle();
    const sepolia = chains[SEPOLIA.id];
    const accounts = sepolia?.options.accounts;
    const erc20 = catalog.facets.find((f) => f.name === "ERC20");
    if (!sepolia || !accounts || !erc20) throw new Error("mock and fixture");
    const key = erc20.release.address.toLowerCase();
    const deployed = accounts[key];
    delete accounts[key];
    await service.probe(SEPOLIA.id, { refresh: true });
    const seen: string[] = [];
    service.subscribeReadiness((chainId) => {
      const r = service.readiness(chainId);
      seen.push(r.status === "ready" ? `ready:${r.state.shared.ERC20?.present}` : r.status);
    });
    // The deploy engine reads the chain before the send, then again after it lands.
    await service.probe(SEPOLIA.id, { refresh: true });
    if (deployed) accounts[key] = deployed;
    const after = service.probe(SEPOLIA.id, { refresh: true });
    // A probe of its own while the re-read runs (the review, a path edit) doesn't drop the ready state either.
    await service.probe(SEPOLIA.id);
    await after;
    await settle();
    expect(seen).toEqual(["ready:true"]);
    expect(seen).not.toContain("checking");
    // Reading through another RPC is a different chain state: that one still goes "checking" first.
    settings.set({ rpc: { [SEPOLIA.id]: "https://mine.example/11155111" } });
    await Bun.sleep(OVERRIDE_WAIT + 10);
    await settle();
    expect(seen.slice(1)).toEqual(["checking", "ready:true"]);
    // And a re-read that fails says so.
    sepolia.down = true;
    await service.probe(SEPOLIA.id, { refresh: true });
    expect(service.readiness(SEPOLIA.id)).toEqual({ status: "error", reason: "Couldn't read Sepolia: the RPC didn't answer." });
  });

  test("a failed read of new addresses from the cache shows an error rather than leaving 'checking'", async () => {
    start();
    await service.probe(SEPOLIA.id);
    const sepolia = chains[SEPOLIA.id];
    if (sepolia) sepolia.down = true;
    const result = await service.probe(SEPOLIA.id, { codeAt: [SAFE] });
    expect(result).toEqual({ ok: false, error: "Sepolia's public RPC isn't answering." });
    expect(service.readiness(SEPOLIA.id)).toEqual({ status: "error", reason: "Couldn't read Sepolia: the RPC didn't answer." });
  });

  test("probes that finish out of order: only the latest publishes", async () => {
    start();
    const sepolia = chains[SEPOLIA.id];
    if (!sepolia) throw new Error("mock");
    let releaseFirst: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    sepolia.intercept = () => held;
    const first = service.probe(SEPOLIA.id, { path: "factory" });
    await settle();
    sepolia.intercept = undefined;
    // A different address set: its own read, which finishes first.
    const second = await service.probe(SEPOLIA.id, { path: "createx", codeAt: [SAFE] });
    expect(second.ok).toBe(true);
    releaseFirst();
    const late = await first;
    expect(late.ok).toBe(true);
    const readiness = service.readiness(SEPOLIA.id);
    expect(readiness.status === "ready" && readiness.state.createx?.present).toBe(true);
    expect(readiness.status === "ready" && readiness.state.codeAt[SAFE.toLowerCase()]).toBe("0x6080");
  });

  test("a revert isn't a connection failure; an unreachable RPC is (probe and readFacets)", async () => {
    start();
    const sepolia = chains[SEPOLIA.id];
    if (!sepolia) throw new Error("mock");
    expect((await service.readFacets(SEPOLIA.id, ME)).ok).toBe(false);
    expect(reported).toBe(0);
    sepolia.intercept = (method) => (method === "eth_simulateV1" ? Object.assign(new Error("execution reverted"), { code: 3 }) : undefined);
    await service.probe(SEPOLIA.id);
    expect(reported).toBe(0);
    sepolia.intercept = undefined;
    sepolia.down = true;
    await service.readFacets(SEPOLIA.id, ME);
    expect(reported).toBe(1);
    await service.probe(SEPOLIA.id, { refresh: true });
    expect(reported).toBeGreaterThan(1);
  });

  test("the RPC ranking timer runs while online and stops offline and on dispose", () => {
    const timers: string[] = [];
    const clients = createClients({
      transport: () => mockChain({ chainId: SEPOLIA.id }).transport(),
      setInterval: () => {
        timers.push("start");
        return timers.length;
      },
      clearInterval: () => timers.push("stop"),
    });
    service = createChainService({ e2e: false, clients, wallet: null });
    expect(timers).toEqual(["start"]);
    setOnline(false);
    expect(timers).toEqual(["start", "stop"]);
    setOnline(true);
    expect(timers).toEqual(["start", "stop", "start"]);
    service.dispose();
    expect(timers).toEqual(["start", "stop", "start", "stop"]);
  });

  test("the RPC ranking timer stops while the tab is hidden and starts again when it's shown", () => {
    let hidden = false;
    const target = new EventTarget();
    const fakeDocument = Object.defineProperty(target, "visibilityState", { get: () => (hidden ? "hidden" : "visible") });
    const had = "document" in globalThis;
    Object.assign(globalThis, { document: fakeDocument });
    try {
      const timers: string[] = [];
      const clients = createClients({
        transport: () => mockChain({ chainId: SEPOLIA.id }).transport(),
        setInterval: () => {
          timers.push("start");
          return timers.length;
        },
        clearInterval: () => timers.push("stop"),
      });
      service = createChainService({ e2e: false, clients, wallet: null });
      hidden = true;
      target.dispatchEvent(new Event("visibilitychange"));
      hidden = false;
      target.dispatchEvent(new Event("visibilitychange"));
      expect(timers).toEqual(["start", "stop", "start"]);
      service.dispose();
    } finally {
      if (!had) delete (globalThis as { document?: unknown }).document;
    }
  });

  test("offline, the reads say so without calling the RPC or reporting a failure", async () => {
    start();
    online = false;
    const sepolia = chains[SEPOLIA.id];
    const calls = sepolia?.calls.length ?? 0;
    expect(await service.codeAt(SEPOLIA.id, SAFE)).toEqual({ ok: false, error: "Chain checks need a connection." });
    expect(await service.readFacets(SEPOLIA.id, SAFE)).toEqual({ ok: false, error: "Chain checks need a connection." });
    expect(await service.resolveEns("alice.eth", SEPOLIA.id)).toEqual({ ok: false, error: "Chain checks need a connection." });
    expect(await service.reverseEns(ME, SEPOLIA.id)).toEqual({ ok: false, error: "Chain checks need a connection." });
    expect(sepolia?.calls.length).toBe(calls);
    expect(reported).toBe(0);
  });

  test("a chain Studio doesn't list, and no catalog yet, say why", async () => {
    start();
    const unknown = await service.probe(5);
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.error).toBe("Studio doesn't deploy to Chain 5. Choose Sepolia, Base Sepolia or HSKChain Testnet.");
    setCatalogStatus({ status: "loading" });
    expect(await service.probe(SEPOLIA.id)).toEqual({ ok: false, error: "The catalog hasn't loaded yet." });
    expect(service.readiness(SEPOLIA.id)).toEqual({ status: "error", reason: "The catalog hasn't loaded yet." });
  });

  test("the picker lists the v1 testnets", () => {
    start();
    expect(service.chains().map((c) => c.name)).toEqual(["Sepolia", "Base Sepolia", "HSKChain Testnet"]);
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
      clients: createClients({ transport: () => chains[SEPOLIA.id]?.transport() ?? mockChain({ chainId: 1 }).transport() }),
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
  function fakeWallet(initial: WalletState | null = null): Wallet & { set(state: WalletState | null): void; switched: [number, string][] } {
    let state = initial;
    const listeners = new Set<(s: WalletState | null) => void>();
    const connectors: WalletConnector[] = [{ id: "io.metamask", name: "MetaMask", kind: "injected", rdns: "io.metamask" }];
    const wallet = {
      config: {} as Config,
      switched: [] as [number, string][],
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
      async switchChain(chainId: number, publicRpc: string) {
        wallet.switched.push([chainId, publicRpc]);
        return { ok: true as const, value: undefined };
      },
      async reconnect() {},
      async loadWalletConnect() {
        return { ok: false as const, error: "WalletConnect isn't set up in this build of Studio." };
      },
      async dropWalletConnect() {
        return false;
      },
      set(next: WalletState | null) {
        state = next;
        for (const listener of listeners) listener(next);
      },
    };
    return wallet;
  }

  test("shown at once, then its kind, balance and primary name, read on the selected chain", async () => {
    const wallet = fakeWallet();
    session.set({ chainId: SEPOLIA.id });
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

  test("with an account, the predicted address is read: NET-05's `predictedHasCode`", async () => {
    const wallet = fakeWallet({ address: ME, chainId: SEPOLIA.id, connector: "io.metamask" });
    start(wallet);
    session.set({ chainId: SEPOLIA.id });
    await settle();
    const free = service.readiness(SEPOLIA.id);
    expect(free.status === "ready" && free.state.predictedHasCode).toBe(false);
    const predicted = predict({ deploy: doc.get().deploy, catalog, chainId: SEPOLIA.id, account: { address: ME } });
    if (predicted.status !== "ready") throw new Error("predicts");
    const sepolia = chains[SEPOLIA.id];
    if (sepolia?.options.accounts) sepolia.options.accounts[predicted.address.toLowerCase()] = { code: "0x60" };
    await service.probe(SEPOLIA.id, { refresh: true });
    const taken = service.readiness(SEPOLIA.id);
    expect(taken.status === "ready" && taken.state.predictedHasCode).toBe(true);
    // A new salt predicts a new, free address.
    doc.record("Use a new salt", (p) => ({ project: { ...p, deploy: { ...p.deploy, entropy: `0x${"ee".repeat(11)}` } }, changed: true, summary: "" }));
    await settle();
    const fresh = service.readiness(SEPOLIA.id);
    expect(fresh.status === "ready" && fresh.state.predictedHasCode).toBe(false);
  });

  test("a gas estimate from the deploy engine lands in the chain state", async () => {
    start();
    session.set({ chainId: SEPOLIA.id });
    await settle();
    service.noteEstimate(SEPOLIA.id, 17_200_000n);
    const noted = service.readiness(SEPOLIA.id);
    expect(noted.status === "ready" && noted.state.gasEstimate).toBe("17200000");
    service.noteEstimate(SEPOLIA.id, null);
    const cleared = service.readiness(SEPOLIA.id);
    expect(cleared.status === "ready" && cleared.state.gasEstimate).toBeUndefined();
  });

  test("a Safe reads as a Safe", async () => {
    const wallet = fakeWallet({ address: SAFE, chainId: SEPOLIA.id, connector: "io.metamask" });
    session.set({ chainId: SEPOLIA.id });
    start(wallet);
    await settle();
    expect(service.account()?.kind).toBe("safe");
  });

  test("a wallet on a chain nobody selected (Ethereum) is never read there", async () => {
    const wallet = fakeWallet({ address: ME, chainId: 1, connector: "io.metamask" });
    session.set({ chainId: SEPOLIA.id });
    start(wallet);
    await settle();
    expect(service.account()).toEqual({ address: ME, chainId: 1, connector: "io.metamask" });
    expect([...urlsCalled].some((url) => url.includes("reth.rs") || url.includes("ethereum-rpc"))).toBe(false);
    // Once the wallet is on the selected chain, its details are read there.
    wallet.set({ address: ME, chainId: SEPOLIA.id, connector: "io.metamask" });
    await settle();
    expect(service.account()?.kind).toBe("eoa");
  });

  test("switching network asks the wallet with the chain's public RPC; an unknown chain says why", async () => {
    const wallet = fakeWallet({ address: ME, chainId: BASE_SEPOLIA.id, connector: "io.metamask" });
    settings.set({ rpc: { [SEPOLIA.id]: "https://sepolia.infura.io/v3/SECRET" } });
    start(wallet);
    expect(await service.switchNetwork(SEPOLIA.id)).toEqual({ ok: true, value: undefined });
    expect(wallet.switched).toEqual([[SEPOLIA.id, SEPOLIA.rpc.default]]);
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
