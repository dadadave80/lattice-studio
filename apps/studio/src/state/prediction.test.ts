import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Address, Hex } from "@lattice-studio/core";
import { buildSalt, createxPredict, factoryPredict, sameAddress } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { doc, provideServices, session } from "@/contracts";
import { fakeChainService, type FakeChain } from "../../test/harness/chain";
import { NEEDS_CHAIN, NEEDS_WALLET, predict } from "./prediction";
import { fixture, setupKit, type Kit } from "./testing";

const ACCOUNT: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SEPOLIA = 11155111;
const ENTROPY: Hex = "0x0102030405060708090a0b";

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("predict", () => {
  const catalog = fixture();
  const deploy = { path: "factory" as const, entropy: ENTROPY, scope: "every-chain" as const };

  test("says why there's no address yet", () => {
    expect(predict({ deploy, catalog, chainId: SEPOLIA, account: null })).toEqual({ status: "none", reason: NEEDS_WALLET });
    expect(predict({ deploy, catalog, chainId: null, account: { address: ACCOUNT } })).toEqual({ status: "none", reason: NEEDS_CHAIN });
    expect(NEEDS_WALLET).toBe("Connect a wallet to see the deploy address (it depends on the deploying account)");
  });

  test("the factory path predicts through LatticeFactory with the sender-prefixed salt", () => {
    const got = predict({ deploy, catalog, chainId: SEPOLIA, account: { address: ACCOUNT } });
    const salt = buildSalt(ACCOUNT, "every-chain", ENTROPY);
    const expected = factoryPredict({ factory: catalog.factory.address, proxyInitCodeHash: catalog.proxy.initCodeHash, from: ACCOUNT, salt });
    expect(got).toEqual({ status: "ready", address: expected, chainId: SEPOLIA, path: "factory", scope: "every-chain", from: ACCOUNT, salt });
  });

  test("the CreateX path predicts through CreateX", () => {
    const got = predict({ deploy: { ...deploy, path: "createx", scope: "this-chain" }, catalog, chainId: SEPOLIA, account: { address: ACCOUNT } });
    const salt = buildSalt(ACCOUNT, "this-chain", ENTROPY);
    expect(got).toMatchObject({ status: "ready", address: createxPredict({ from: ACCOUNT, salt, chainId: SEPOLIA }) });
  });
});

describe("usePrediction's mirror", () => {
  let kit: Kit;
  let chain: FakeChain;
  let disposeChain: () => void;
  beforeEach(() => {
    kit = setupKit();
    doc.load(makeProject({ recipe: makeRecipe({}, kit.catalog), deploy: { path: "factory", entropy: ENTROPY, scope: "every-chain" } }));
    chain = fakeChainService({ account: { address: ACCOUNT, chainId: SEPOLIA, connector: "io.metamask" } });
    disposeChain = provideServices({ chain: async () => chain });
  });
  afterEach(() => {
    disposeChain();
    kit.dispose();
  });

  test("records a new prediction once, through doc.record, with no undo step", async () => {
    expect(kit.state.prediction.get()).toMatchObject({ status: "none", reason: NEEDS_WALLET });
    session.set({ chainId: SEPOLIA });
    await flush();
    const p = kit.state.prediction.get();
    expect(p.status).toBe("ready");
    if (p.status !== "ready") return;
    expect(doc.get().predicted).toEqual([{ chainId: SEPOLIA, address: p.address }]);
    expect(doc.state()).toMatchObject({ canUndo: false, lastChange: { kind: "record" } });
    session.set({ tool: "hand" });
    doc.apply("Renamed", (q) => ({ project: { ...q, name: "X" }, changed: true, summary: "Renamed" }));
    await flush();
    expect(doc.get().predicted).toHaveLength(1);
  });

  test("a new salt records the new address; the current one stays out of AUTH-02's known", async () => {
    session.set({ chainId: SEPOLIA });
    await flush();
    const first = kit.state.prediction.get();
    if (first.status !== "ready") throw new Error("expected a prediction");
    expect(kit.state.analysis.context().known).toEqual([]);
    expect(kit.state.analysis.context().refs).toEqual({ self: first.address, deployer: ACCOUNT });
    expect(kit.state.analysis.context().deploy).toEqual({ chainId: SEPOLIA, path: "factory", from: ACCOUNT, salt: first.salt });

    doc.record("New salt", (q) => ({ project: { ...q, deploy: { ...q.deploy, entropy: "0x0b0a090807060504030201" as Hex } }, changed: true, summary: "New salt" }));
    await flush();
    const second = kit.state.prediction.get();
    if (second.status !== "ready") throw new Error("expected a prediction");
    expect(sameAddress(second.address, first.address)).toBe(false);
    expect(doc.get().predicted.map((q) => q.address)).toEqual([first.address, second.address]);
    const ctx = kit.state.analysis.context();
    expect(ctx.known).toEqual([first.address]);
    expect(ctx.knownFrom).toEqual({ [first.address.toLowerCase()]: { source: "prediction", chainId: SEPOLIA, chain: "Sepolia" } });
  });

  test("a read-only tab records nothing", async () => {
    session.set({ readOnly: "Another tab is editing this project.", chainId: SEPOLIA });
    await flush();
    expect(kit.state.prediction.get().status).toBe("ready");
    expect(doc.get().predicted).toEqual([]);
  });

  test("the chain module isn't loaded until a chain is selected", async () => {
    await flush();
    expect(chain.calls.length).toBe(0);
    expect(kit.state.chain.account()).toBeNull();
    session.set({ chainId: SEPOLIA });
    await flush();
    expect(kit.state.chain.account()?.address).toBe(ACCOUNT);
  });

  test("without S8a the prediction waits for a wallet, and nothing crashes", async () => {
    disposeChain();
    session.set({ chainId: SEPOLIA });
    await flush();
    expect(kit.state.prediction.get()).toEqual({ status: "none", reason: NEEDS_WALLET });
    disposeChain = () => {};
  });
});
