/**
 * Wallets through wagmi: EIP-6963 discovery (browser wallets announcing EIP-1193 providers), connecting, the
 * Flow 14 messages, switching network with error 4902, and the end-to-end mock connector. `bun test` has no
 * `window`, so the global object stands in for one while these run.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Address } from "@lattice-studio/core";
import type { Chain } from "viem";
import { custom, numberToHex } from "viem";
import { BASE_SEPOLIA, SEPOLIA } from "./chains";
import { viemChain } from "./clients";
import { ANVIL_ACCOUNT, e2eConnectors } from "./e2e";
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

describe("end-to-end builds", () => {
  test("wagmi's mock connector with Anvil's account 0", async () => {
    const w = wallet({ connectors: e2eConnectors(), discovery: false });
    expect(w.connectors().map((c) => c.kind)).toEqual(["mock", "walletconnect"]);
    const result = await w.connect();
    expect(result.ok && result.value.address).toBe(ANVIL_ACCOUNT);
  });
});
