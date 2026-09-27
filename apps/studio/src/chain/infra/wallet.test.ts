/**
 * Wallets through wagmi: EIP-6963 discovery (browser wallets announcing EIP-1193 providers), connecting, the
 * Flow 14 messages, switching network with error 4902, and the end-to-end mock connector. `bun test` has no
 * `window`, so the global object stands in for one while these run.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Address } from "@lattice-studio/core";
import type { Chain } from "viem";
import { custom, numberToHex } from "viem";
import { ANVIL, BASE_SEPOLIA, SEPOLIA } from "./chains";
import { extractRpcUrls } from "@wagmi/core";
import { createClients, viemChain } from "./clients";
import { settings } from "@/contracts";
import { isolateContracts } from "@/contracts/test-support";
import { recordedLog } from "@/contracts/kernel";
import { WALLETCONNECT_NOT_SET_UP } from "./copy";
import { delegate, followWalletConnectSetting, loadWalletConnect, walletChains } from "./runtime";
import { ANVIL_ACCOUNT, e2eConnectors, notAnvil } from "./e2e";
import { createWallet, LEGACY_INJECTED_ID, WALLETCONNECT_ID, type Wallet } from "./wallet";

const ME = "0x3333333333333333333333333333333333333333" as Address;
const CHAINS = [viemChain(SEPOLIA, [SEPOLIA.rpc.default]), viemChain(BASE_SEPOLIA, [BASE_SEPOLIA.rpc.default])] as [Chain, ...Chain[]];

type Listener = (...args: unknown[]) => void;

/** A browser wallet: an EIP-1193 provider that knows some chains, and its EIP-6963 announcement. */
function fakeWallet(options: { rdns: string; name: string; chainId?: number; known?: number[]; reject?: boolean }) {
  let chainId = options.chainId ?? SEPOLIA.id;
  const known = new Set(options.known ?? [SEPOLIA.id]);
  const listeners = new Map<string, Set<Listener>>();
  const requests: { method: string; params?: unknown }[] = [];
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  const provider = {
    requests,
    async request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
      requests.push({ method, params });
      switch (method) {
        case "wallet_requestPermissions":
        case "eth_requestAccounts":
          if (options.reject) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          return method === "eth_requestAccounts" ? [ME] : [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [ME] }] }];
        case "eth_accounts":
          return [ME];
        case "eth_chainId":
          return numberToHex(chainId);
        case "wallet_switchEthereumChain": {
          const next = Number((params as [{ chainId: string }])[0].chainId);
          if (!known.has(next)) throw Object.assign(new Error("Unrecognized chain ID."), { code: 4902 });
          chainId = next;
          emit("chainChanged", numberToHex(next));
          return null;
        }
        case "wallet_addEthereumChain": {
          const next = Number((params as [{ chainId: string }])[0].chainId);
          known.add(next);
          chainId = next;
          emit("chainChanged", numberToHex(next));
          return null;
        }
        case "wallet_revokePermissions":
          return null;
        default:
          throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
      }
    },
    on(event: string, listener: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(listener);
    },
    removeListener(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener);
    },
  };
  const info = { uuid: crypto.randomUUID(), name: options.name, icon: "data:image/svg+xml,<svg/>", rdns: options.rdns };
  const announce = () => globalThis.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  globalThis.addEventListener("eip6963:requestProvider", announce);
  return { provider, info, announce, dispose: () => globalThis.removeEventListener("eip6963:requestProvider", announce) };
}

const unreachable = () => custom({ request: async () => { throw new Error("no RPC in wallet tests"); } });
const disposers: (() => void)[] = [];
const hadWindow = "window" in globalThis;

beforeAll(() => {
  if (!hadWindow) Object.assign(globalThis, { window: globalThis });
});

afterAll(() => {
  if (!hadWindow) delete (globalThis as { window?: unknown }).window;
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function wallet(options: Partial<Parameters<typeof createWallet>[0]> = {}): Wallet {
  return createWallet({ chains: CHAINS, transport: unreachable, storage: null, legacyInjected: () => false, ...options });
}

describe("EIP-6963", () => {
  test("announced wallets are listed by name, then Other wallets (QR)", async () => {
    const metamask = fakeWallet({ rdns: "io.metamask", name: "MetaMask" });
    const rabby = fakeWallet({ rdns: "io.rabby", name: "Rabby Wallet" });
    disposers.push(metamask.dispose, rabby.dispose);
    const w = wallet();
    expect(w.connectors().map((c) => `${c.kind}:${c.name}`)).toEqual(["injected:MetaMask", "injected:Rabby Wallet", "walletconnect:Other wallets (QR)"]);
    expect(w.connectors()[0]).toMatchObject({ id: "io.metamask", rdns: "io.metamask", icon: "data:image/svg+xml,<svg/>" });
  });

  test("a wallet that announces later shows up, and subscribers hear it", async () => {
    const w = wallet();
    const heard: string[][] = [];
    const stop = w.subscribeConnectors((list) => heard.push(list.map((c) => c.name)));
    const late = fakeWallet({ rdns: "com.example.late", name: "Late Wallet" });
    disposers.push(late.dispose, stop);
    late.announce();
    expect(w.connectors().map((c) => c.name)).toEqual(["Late Wallet", "Other wallets (QR)"]);
    expect(heard.at(-1)).toEqual(["Late Wallet", "Other wallets (QR)"]);
  });

  test("connect: the first browser wallet without an id, a chosen one by id; subscribers hear the account", async () => {
    const metamask = fakeWallet({ rdns: "io.metamask", name: "MetaMask" });
    disposers.push(metamask.dispose);
    const w = wallet();
    const heard: unknown[] = [];
    disposers.push(w.subscribe((state) => heard.push(state)));
    const result = await w.connect();
    expect(result).toEqual({ ok: true, value: { address: ME, chainId: SEPOLIA.id, connector: "io.metamask" } });
    expect(w.state()).toEqual({ address: ME, chainId: SEPOLIA.id, connector: "io.metamask" });
    expect(heard.at(-1)).toEqual({ address: ME, chainId: SEPOLIA.id, connector: "io.metamask" });
    expect(await w.connect("io.metamask")).toEqual(result);
    await w.disconnect();
    expect(w.state()).toBeNull();
  });
});

describe("Flow 14", () => {
  test("no wallet in the browser", async () => {
    const w = wallet();
    expect(w.connectors().map((c) => c.id)).toEqual([WALLETCONNECT_ID]);
    expect(await w.connect()).toEqual({ ok: false, error: "No wallet found in this browser." });
    expect(await w.connect("io.metamask")).toEqual({ ok: false, error: "No wallet found in this browser." });
  });

  test("a wallet without EIP-6963 is still offered through window.ethereum", () => {
    const w = wallet({ legacyInjected: () => true });
    expect(w.connectors().map((c) => c.id)).toEqual([LEGACY_INJECTED_ID, WALLETCONNECT_ID]);
    expect(w.connectors()[0]?.name).toBe("Browser wallet");
  });

  test("rejecting in the wallet", async () => {
    const shy = fakeWallet({ rdns: "io.metamask", name: "MetaMask", reject: true });
    disposers.push(shy.dispose);
    expect(await wallet().connect()).toEqual({ ok: false, error: "You canceled in your wallet." });
  });

  test("WalletConnect without a project id says it isn't set up", async () => {
    const w = wallet({ walletConnect: async () => ({ ok: false, error: "WalletConnect isn't set up in this build of Studio." }) });
    expect(await w.connect(WALLETCONNECT_ID)).toEqual({ ok: false, error: "WalletConnect isn't set up in this build of Studio." });
  });

  test("switch network adds the chain on error 4902 with its public RPC, then switches", async () => {
    const metamask = fakeWallet({ rdns: "io.metamask", name: "MetaMask", known: [SEPOLIA.id] });
    disposers.push(metamask.dispose);
    const w = wallet();
    await w.connect();
    const result = await w.switchChain(BASE_SEPOLIA.id, BASE_SEPOLIA.rpc.default);
    expect(result).toEqual({ ok: true, value: undefined });
    const added = metamask.provider.requests.find((r) => r.method === "wallet_addEthereumChain");
    expect(added?.params).toEqual([expect.objectContaining({ chainId: numberToHex(BASE_SEPOLIA.id), chainName: "Base Sepolia", rpcUrls: [BASE_SEPOLIA.rpc.default] })]);
    expect(w.state()?.chainId).toBe(BASE_SEPOLIA.id);
  });

  test("switching with no wallet connected says to connect one", async () => {
    expect(await wallet().switchChain(SEPOLIA.id, SEPOLIA.rpc.default)).toEqual({ ok: false, error: "Connect a wallet first." });
  });
});

describe("the person's own RPC stays out of the wallet", () => {
  test("wagmi's chains and the URLs its connectors extract (WalletConnect's rpcMap) are public only", () => {
    const secret = "https://sepolia.infura.io/v3/SECRET";
    const overrides = { [SEPOLIA.id]: secret, [BASE_SEPOLIA.id]: "https://base-sepolia.g.alchemy.com/v2/SECRET" };
    const clients = createClients({ overrides, transport: () => custom({ request: async () => "0x1" }) });
    // Reads do go through the person's RPC…
    expect(clients.urls(SEPOLIA)[0]).toBe(secret);
    // …but the wallet's config never carries it.
    const w = wallet({ chains: walletChains(false, overrides), transport: (chainId) => delegate(clients, chainId) });
    for (const chain of w.config.chains) {
      const urls = [...chain.rpcUrls.default.http, ...extractRpcUrls({ chain, transports: w.config._internal.transports })];
      expect(urls.some((url) => url.includes("SECRET"))).toBe(false);
    }
  });

  test("Anvil's local node is the exception, in end-to-end builds", () => {
    const chains = walletChains(true, { 31337: "http://127.0.0.1:20043" });
    expect(chains.find((c) => c.id === 31337)?.rpcUrls.default.http[0]).toBe("http://127.0.0.1:20043");
  });
});

describe("WalletConnect's setting", () => {
  test("turns on only once its code has loaded; a failed load or no project id leaves it off", async () => {
    const restore = isolateContracts();
    try {
      expect(settings.get().walletConnect).toBe(false);
      expect(await loadWalletConnect(undefined, () => Promise.reject(new Error("never loaded")))).toEqual({ ok: false, error: "WalletConnect isn't set up in this build of Studio." });
      await expect(loadWalletConnect("project", () => Promise.reject(new Error("Failed to fetch dynamically imported module")))).rejects.toThrow();
      expect(settings.get().walletConnect).toBe(false);
      const connector = (() => ({})) as unknown as ReturnType<typeof e2eConnectors>[number];
      const loaded = await loadWalletConnect("project", async () => ({ walletConnectConnector: () => connector }));
      expect(loaded).toEqual({ ok: true, value: connector });
      expect(settings.get().walletConnect).toBe(true);
    } finally {
      restore();
    }
  });

  describe("the chain module follows Settings → Wallet (spec L635)", () => {
    type Loaded = Awaited<ReturnType<Wallet["loadWalletConnect"]>>;
    /** The wallet's WalletConnect side, recording what the setting asked of it. */
    function fakeWalletConnect(load: () => Promise<Loaded>) {
      const asked: string[] = [];
      return {
        asked,
        loadWalletConnect: () => {
          asked.push("load");
          return load();
        },
        dropWalletConnect: async () => {
          asked.push("drop");
          return true;
        },
      };
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    let restore: () => void = () => {};
    afterEach(() => restore());

    test("off: a WalletConnect session ends and the connector is dropped", async () => {
      restore = isolateContracts();
      settings.set({ walletConnect: true });
      const fake = fakeWalletConnect(async () => ({ ok: true, value: undefined }));
      const stop = followWalletConnectSetting(fake);
      await settle();
      expect(fake.asked).toEqual(["load"]);
      settings.set({ walletConnect: false });
      await settle();
      expect(fake.asked).toEqual(["load", "drop"]);
      stop();
      settings.set({ walletConnect: true });
      expect(fake.asked).toEqual(["load", "drop"]);
    });

    test("on: WalletConnect loads, and the setting stays on once it has", async () => {
      restore = isolateContracts();
      const fake = fakeWalletConnect(async () => ({ ok: true, value: undefined }));
      const stop = followWalletConnectSetting(fake);
      expect(fake.asked).toEqual([]);
      settings.set({ walletConnect: true });
      await settle();
      expect(fake.asked).toEqual(["load"]);
      expect(settings.get().walletConnect).toBe(true);
      stop();
    });

    test("on without a project id: back off, and the console says why", async () => {
      restore = isolateContracts();
      const before = recordedLog().length;
      const fake = fakeWalletConnect(async () => ({ ok: false, error: WALLETCONNECT_NOT_SET_UP }));
      const stop = followWalletConnectSetting(fake);
      settings.set({ walletConnect: true });
      await settle();
      expect(settings.get().walletConnect).toBe(false);
      expect(recordedLog().slice(before).map((line) => [line.tag, line.text])).toEqual([["Note", WALLETCONNECT_NOT_SET_UP]]);
      stop();
    });

    test("on with a chunk that won't load: back off, and S11a's banner speaks for the chunk", async () => {
      restore = isolateContracts();
      const before = recordedLog().length;
      const fake = fakeWalletConnect(() => Promise.reject(new Error("Failed to fetch dynamically imported module")));
      const stop = followWalletConnectSetting(fake);
      settings.set({ walletConnect: true });
      await settle();
      expect(settings.get().walletConnect).toBe(false);
      expect(recordedLog().slice(before)).toEqual([]);
      stop();
    });
  });
});

describe("end-to-end builds", () => {
  test("wagmi's mock connector with Anvil's account 0", async () => {
    const w = wallet({ connectors: e2eConnectors(), discovery: false });
    expect(w.connectors().map((c) => c.kind)).toEqual(["mock", "walletconnect"]);
    const result = await w.connect();
    expect(result.ok && result.value.address).toBe(ANVIL_ACCOUNT);
  });

  describe("the mock sends on the chain it's on, and only ever to local Anvil", () => {
    // A fake Anvil URL: fetch is stubbed below, so nothing leaves the test (nor would a request to Sepolia).
    const ANVIL_URL = "http://127.0.0.1:1/anvil";
    const E2E_CHAINS = [
      viemChain(SEPOLIA, [SEPOLIA.rpc.default]),
      viemChain(BASE_SEPOLIA, [BASE_SEPOLIA.rpc.default]),
      viemChain(ANVIL, [ANVIL_URL]),
    ] as [Chain, ...Chain[]];
    const TX_HASH = `0x${"ab".repeat(32)}`;
    const realFetch = globalThis.fetch;
    let sent: { url: string; body: { method?: string; params?: [{ chainId?: string }] } }[] = [];

    beforeAll(() => {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const body = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method?: string; params?: [{ chainId?: string }] };
        sent.push({ url, body });
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? 0, result: TX_HASH }), { headers: { "content-type": "application/json" } });
      }) as typeof fetch;
    });
    afterAll(() => {
      globalThis.fetch = realFetch;
    });
    afterEach(() => {
      sent = [];
    });

    /** The connected connector's provider, fetched the way the deploy engine does (app-port: no chain id). */
    async function provider(w: Wallet): Promise<{ request(args: { method: string; params?: unknown }): Promise<unknown> }> {
      const { current, connections } = w.config.state;
      const connector = current === null ? undefined : connections.get(current)?.connector;
      if (!connector) throw new Error("not connected");
      return (await connector.getProvider()) as { request(args: { method: string; params?: unknown }): Promise<unknown> };
    }

    const send = (chainId: number) => ({
      method: "eth_sendTransaction",
      params: [{ from: ANVIL_ACCOUNT, chainId: numberToHex(chainId), to: ME, data: "0x", value: "0x0" }],
    });

    test("on Anvil, eth_sendTransaction goes to Anvil's RPC with Anvil's chain id", async () => {
      const w = wallet({ chains: E2E_CHAINS, connectors: e2eConnectors(), discovery: false });
      await w.connect();
      expect(await w.switchChain(ANVIL.id, ANVIL_URL)).toEqual({ ok: true, value: undefined });
      expect(w.state()?.chainId).toBe(ANVIL.id);
      const wallet1193 = await provider(w);
      expect(await wallet1193.request(send(ANVIL.id))).toBe(TX_HASH);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.url).toBe(ANVIL_URL);
      expect(sent[0]?.body.method).toBe("eth_sendTransaction");
      expect(sent[0]?.body.params?.[0].chainId).toBe(numberToHex(31337));
    });

    test("a provider kept from before the switch follows the wallet to Anvil", async () => {
      const w = wallet({ chains: E2E_CHAINS, connectors: e2eConnectors(), discovery: false });
      await w.connect();
      const kept = await provider(w);
      await w.switchChain(ANVIL.id, ANVIL_URL);
      await kept.request(send(ANVIL.id));
      expect(sent.map((s) => s.url)).toEqual([ANVIL_URL]);
    });

    test("on any other chain it refuses to send, and nothing is fetched", async () => {
      const w = wallet({ chains: E2E_CHAINS, connectors: e2eConnectors(), discovery: false });
      await w.connect();
      // The mock starts on the config's first chain, Sepolia.
      expect(w.state()?.chainId).toBe(SEPOLIA.id);
      const wallet1193 = await provider(w);
      await expect(wallet1193.request(send(SEPOLIA.id))).rejects.toThrow(notAnvil(SEPOLIA.id));
      await expect(wallet1193.request({ method: "wallet_sendCalls", params: [{ calls: [] }] })).rejects.toThrow(notAnvil(SEPOLIA.id));
      await expect(wallet1193.request({ method: "eth_call", params: [] })).rejects.toThrow(notAnvil(SEPOLIA.id));
      const connector = w.config.state.connections.get(w.config.state.current ?? "")?.connector;
      const onSepolia = (await connector?.getProvider({ chainId: SEPOLIA.id })) as { request(args: { method: string; params?: unknown }): Promise<unknown> };
      await expect(onSepolia.request(send(SEPOLIA.id))).rejects.toThrow(notAnvil(SEPOLIA.id));
      expect(sent).toEqual([]);
    });

    test("what the mock answers itself still works on any chain", async () => {
      const w = wallet({ chains: E2E_CHAINS, connectors: e2eConnectors(), discovery: false });
      await w.connect();
      const wallet1193 = await provider(w);
      expect(await wallet1193.request({ method: "eth_chainId" })).toBe(numberToHex(SEPOLIA.id));
      expect(await wallet1193.request({ method: "eth_accounts" })).toEqual([ANVIL_ACCOUNT]);
      expect(sent).toEqual([]);
    });
  });
});
