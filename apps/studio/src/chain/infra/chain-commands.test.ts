/** S8a's commands through the registry, against the harness's fake chain service. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CommandId, CommandRef } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import {
  commandState, defineCommands, doc, getCommand, provideServices, registerDialog, runCommand, session, setCatalogStatus,
} from "@/contracts";
import { bufferedServices } from "@/contracts/services";
import { isolateContracts } from "@/contracts/test-support";
import { fakeChainService, type FakeChain } from "../../../test/harness/chain";
import { CHAIN_COMMANDS } from "./chain-commands";
import { fixtureCatalog } from "./testing";

const ME = "0x3333333333333333333333333333333333333333" as const;
let restore: () => void;
let online = true;
let from = 0;

beforeEach(() => {
  restore = isolateContracts();
  online = true;
  provideServices({ connection: { isOnline: () => online, subscribe: () => () => {} } });
  const catalog = fixtureCatalog();
  setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
  doc.load(makeProject());
  defineCommands(CHAIN_COMMANDS);
  from = bufferedServices().log.length;
});

afterEach(() => restore());

function serve(chain: FakeChain): FakeChain {
  provideServices({ chain: async () => chain });
  return chain;
}

function lines(): string[] {
  return bufferedServices().log.slice(from).map((line) => `${line.tag}: ${line.text}`);
}

function state(id: CommandId, args?: Record<string, unknown>) {
  return commandState((args ? { id, args } : { id }) as CommandRef);
}

function parse(argv: string[]) {
  const console = getCommand("chain.select").console;
  if (!console) throw new Error("chain.select has a console verb");
  return console.parse(argv);
}

describe("chain.select", () => {
  test("`chain <name or id>` takes names in any case and spacing, or ids", () => {
    expect(parse(["sepolia"])).toEqual({ ok: true, value: { chainId: 11155111 } });
    expect(parse(["Base", "Sepolia"])).toEqual({ ok: true, value: { chainId: 84532 } });
    expect(parse(["basesepolia"])).toEqual({ ok: true, value: { chainId: 84532 } });
    expect(parse(["84532"])).toEqual({ ok: true, value: { chainId: 84532 } });
    expect(parse(["hskchain", "testnet"])).toEqual({ ok: true, value: { chainId: 133 } });
    expect(parse(["133"])).toEqual({ ok: true, value: { chainId: 133 } });
    expect(parse(["Hedera", "Testnet"])).toEqual({ ok: true, value: { chainId: 296 } });
    expect(parse(["296"])).toEqual({ ok: true, value: { chainId: 296 } });
    expect(parse(["mainnet"])).toEqual({ ok: false, error: "Studio doesn't deploy to mainnet. Choose Sepolia, Base Sepolia, HSKChain Testnet, Hedera Testnet or Avalanche Fuji." });
    expect(parse([])).toEqual({ ok: false, error: "chain takes a chain: Sepolia, Base Sepolia, HSKChain Testnet, Hedera Testnet or Avalanche Fuji." });
  });

  test("selects the chain, says so, and probes it with the project's path", async () => {
    const chain = serve(fakeChainService({ catalog: fixtureCatalog() }));
    expect(state("chain.select", { chainId: 84532 })).toMatchObject({ ok: true, title: "Select Base Sepolia" });
    await runCommand({ id: "chain.select", args: { chainId: 84532 } }, "console");
    expect(session.get().chainId).toBe(84532);
    expect(lines()).toContain("Note: Selected Base Sepolia.");
    expect(chain.calls.find((c) => c.method === "probe")?.args).toEqual([84532, { path: "factory" }]);
  });

  test("an unlisted chain is disabled with the reason", () => {
    expect(state("chain.select", { chainId: 1 })).toMatchObject({ ok: false, reason: "Studio doesn't deploy to Ethereum. Choose Sepolia, Base Sepolia, HSKChain Testnet, Hedera Testnet or Avalanche Fuji." });
  });

  test("a probe that fails is an Error line", async () => {
    const chain = serve(fakeChainService({ catalog: fixtureCatalog(), down: [84532] }));
    await runCommand({ id: "chain.select", args: { chainId: 84532 } }, "console");
    expect(chain.calls.some((c) => c.method === "probe")).toBe(true);
    expect(lines()).toContain("Error: Base Sepolia's public RPC isn't answering.");
  });

  test("wallet.connect has no console verb (IR L139-L160 lists none)", () => {
    expect(getCommand("wallet.connect").console).toBeUndefined();
  });

  test("selecting the selected chain checks it again", async () => {
    const chain = serve(fakeChainService({ catalog: fixtureCatalog() }));
    session.set({ chainId: 11155111 });
    await runCommand({ id: "chain.select", args: { chainId: 11155111 } }, "api");
    expect(lines()).toContain("Note: Sepolia is already selected. Checking it again.");
    expect(chain.calls.filter((c) => c.method === "probe")).toHaveLength(1);
  });
});

describe("chain.retryRead", () => {
  test("needs a chain and a connection", () => {
    expect(state("chain.retryRead")).toMatchObject({ ok: false, reason: "Choose a chain first.", title: "Retry reading the chain" });
    session.set({ chainId: 11155111 });
    expect(state("chain.retryRead")).toMatchObject({ ok: true, title: "Retry reading Sepolia" });
    online = false;
    expect(state("chain.retryRead")).toMatchObject({ ok: false, reason: "Chain checks need a connection." });
  });

  test("reads again past the cache, and says what happened", async () => {
    const chain = serve(fakeChainService({ catalog: fixtureCatalog() }));
    session.set({ chainId: 11155111 });
    await runCommand({ id: "chain.retryRead" }, "button");
    expect(chain.calls.find((c) => c.method === "probe")?.args).toEqual([11155111, { refresh: true, path: "factory" }]);
    expect(lines()).toContain("Note: Read Sepolia again.");
    chain.setDown(11155111, true);
    await runCommand({ id: "chain.retryRead" }, "button");
    expect(lines()).toContain("Error: Sepolia's public RPC isn't answering.");
  });
});

describe("chain.useAnotherRpc", () => {
  test("opens Settings → Networks, or says Settings aren't built yet", async () => {
    await runCommand({ id: "chain.useAnotherRpc" }, "button");
    expect(lines()).toContain("Note: Not built yet · WP-S10");
    const dispose = registerDialog("settings", () => null);
    await runCommand({ id: "chain.useAnotherRpc" }, "button");
    expect(session.get().dialogs.at(-1)).toMatchObject({ id: "settings", props: { group: "networks" } });
    dispose();
  });
});

describe("wallet.connect", () => {
  test("connects and names the account and wallet", async () => {
    serve(fakeChainService({ account: { address: ME, chainId: 11155111, connector: "io.metamask" } }));
    await runCommand({ id: "wallet.connect" }, "palette");
    expect(lines()).toContain("Note: Connected 0x3333…3333 through MetaMask.");
  });

  test("no wallet: Flow 14's words", async () => {
    serve(fakeChainService({ account: null }));
    await runCommand({ id: "wallet.connect" }, "palette");
    expect(lines()).toContain("Error: No wallet found in this browser.");
  });

  test("before the chain module exists, it says it's not built", async () => {
    await runCommand({ id: "wallet.connect" }, "palette");
    expect(lines()).toContain("Note: Not built yet · WP-S8a");
  });
});

describe("wallet.switchNetwork", () => {
  test("needs a chain; without a wallet says to connect one; on the chain already says so", async () => {
    expect(state("wallet.switchNetwork")).toMatchObject({ ok: false, reason: "Choose a chain first." });
    session.set({ chainId: 11155111 });
    const chain = serve(fakeChainService({ account: null }));
    await runCommand({ id: "wallet.switchNetwork" }, "button");
    expect(lines()).toContain("Note: Connect a wallet first.");
    chain.setAccount({ address: ME, chainId: 11155111, connector: "io.metamask" });
    await runCommand({ id: "wallet.switchNetwork" }, "button");
    expect(lines()).toContain("Note: Your wallet is on Sepolia. Nothing to switch.");
  });

  test("asks the wallet to switch and says it did", async () => {
    session.set({ chainId: 11155111 });
    const chain = serve(fakeChainService({ account: { address: ME, chainId: 84532, connector: "io.metamask" } }));
    await runCommand({ id: "wallet.switchNetwork" }, "button");
    expect(chain.calls.find((c) => c.method === "switchNetwork")?.args).toEqual([11155111]);
    expect(lines()).toContain("Note: Switched your wallet to Sepolia.");
  });
});
