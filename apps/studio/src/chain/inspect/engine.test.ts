import { describe, expect, test } from "bun:test";
import type { Address, Hex, Result } from "@lattice-studio/core";
import { makeCatalog, makeFacet } from "@lattice-studio/core/testing";
import { createInspectionEngine, type InspectionPorts, type InspectionTarget } from "./engine";
import type { DiamondSnapshot, SnapshotReadError } from "./snapshot";

const TARGET: InspectionTarget = { chainId: 11155111, address: "0x00000000000000000000000000000000000000aa" };
const facet = makeFacet({ name: "Token", selectors: ["balanceOf(address)"] });
const catalog = makeCatalog({ facets: [facet] });

function snapshot(block = 1): DiamondSnapshot {
  return {
    block, blockHash: `0x${block.toString(16).padStart(64, "0")}` as Hex,
    code: "0x6000", facets: [{ facetAddress: facet.release.address, functionSelectors: facet.selectors.map((s) => s.hex) }],
    codehashes: { [facet.release.address.toLowerCase()]: facet.release.codehash }, ownerRouted: false, owner: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function ports(overrides: Partial<InspectionPorts> = {}): InspectionPorts {
  return {
    chains: [{ id: TARGET.chainId, name: "Sepolia", testnet: true }],
    read: () => Promise.resolve({ ok: true, value: snapshot() }),
    catalogs: () => Promise.resolve({ ok: true, value: [catalog] }),
    ...overrides,
  };
}

describe("inspection engine", () => {
  test("is lazy, publishes known facets and uses the shared passport", async () => {
    let calls = 0;
    const data = snapshot();
    const before = JSON.stringify(data);
    const engine = createInspectionEngine(ports({ read: async () => { calls++; return { ok: true, value: data }; } }));
    expect(engine.get(TARGET)).toBe(engine.get(TARGET));
    expect(engine.get(TARGET).status).toBe("idle");
    expect(calls).toBe(0);
    await engine.ensure(TARGET);
    const state = engine.get(TARGET);
    expect(state.status).toBe("ready");
    if (state.status !== "ready") throw new Error("Inspection did not finish.");
    expect(state.value.facets[0]?.name).toBe("Token");
    expect(state.value.passport.claims.map((claim) => claim.id)).toEqual(["PP-01", "PP-02", "PP-03", "PP-04", "PP-05", "PP-06", "PP-07", "PP-08"]);
    expect(state.value.snapshot.block).toBe(1);
    expect(JSON.stringify(data)).toBe(before);
    await engine.ensure(TARGET);
    expect(calls).toBe(1);
    engine.dispose();
  });

  test("deduplicates in-flight work and address casing", async () => {
    const read = deferred<Result<DiamondSnapshot, SnapshotReadError>>();
    let calls = 0;
    const engine = createInspectionEngine(ports({ read: () => { calls++; return read.promise; } }));
    const first = engine.ensure(TARGET);
    const upper = { ...TARGET, address: TARGET.address.toUpperCase().replace("0X", "0x") as Address };
    expect(engine.ensure(upper)).toBe(first);
    await Promise.resolve();
    expect(calls).toBe(1);
    read.resolve({ ok: true, value: snapshot() });
    await first;
    expect(engine.get(upper)).toBe(engine.get(TARGET));
    engine.dispose();
  });

  test("a refresh wins over an older response even if the reader ignores cancellation", async () => {
    const reads = [deferred<Result<DiamondSnapshot, SnapshotReadError>>(), deferred<Result<DiamondSnapshot, SnapshotReadError>>()];
    let calls = 0;
    const engine = createInspectionEngine(ports({ read: () => reads[calls++]!.promise }));
    const first = engine.ensure(TARGET);
    await Promise.resolve();
    const fresh = engine.refresh(TARGET);
    await Promise.resolve();
    reads[1]!.resolve({ ok: true, value: snapshot(2) });
    await fresh;
    reads[0]!.resolve({ ok: true, value: snapshot(1) });
    await first;
    const state = engine.get(TARGET);
    if (state.status !== "ready") throw new Error("The latest inspection was lost.");
    expect(state.value.snapshot.block).toBe(2);
    engine.dispose();
  });

  test("no code and a reverting/nonexistent loupe are separate outcomes", async () => {
    let next: DiamondSnapshot = { ...snapshot(), code: "0x", facets: null };
    const engine = createInspectionEngine(ports({ read: async () => ({ ok: true, value: next }) }));
    await engine.ensure(TARGET);
    expect(engine.get(TARGET).status).toBe("no-code");
    next = { ...snapshot(), code: "0x6000", facets: null };
    await engine.refresh(TARGET);
    const state = engine.get(TARGET);
    expect(state.status).toBe("not-diamond");
    if (state.status !== "not-diamond") throw new Error("The failed loupe was not retained.");
    expect(state.value.passport.claims.find((claim) => claim.id === "PP-02")?.status).toBe("fail");
    engine.dispose();
  });

  test("separates observations of the same address on different chains", async () => {
    const other = { ...TARGET, chainId: 84532 };
    const engine = createInspectionEngine(ports({ chains: [
      { id: TARGET.chainId, name: "Sepolia", testnet: true }, { id: other.chainId, name: "Base Sepolia", testnet: true },
    ] }));
    await Promise.all([engine.ensure(TARGET), engine.ensure(other)]);
    const first = engine.get(TARGET);
    const second = engine.get(other);
    if (first.status !== "ready" || second.status !== "ready") throw new Error("Both inspections must finish.");
    expect(first.value.passport.chainId).toBe(TARGET.chainId);
    expect(second.value.passport.chainId).toBe(other.chainId);
    expect(first.value.identity).not.toBe(second.value.identity);
    engine.dispose();
  });

  test("an RPC error stays an error until explicit Retry", async () => {
    let calls = 0;
    const engine = createInspectionEngine(ports({ read: async () => {
      calls++;
      return calls === 1 ? { ok: false, error: { kind: "rpc", reason: "Sepolia's RPC isn't answering." } } : { ok: true, value: snapshot() };
    } }));
    await engine.ensure(TARGET);
    expect(engine.get(TARGET)).toEqual({ status: "error", reason: "Sepolia's RPC isn't answering." });
    await engine.ensure(TARGET);
    expect(calls).toBe(1);
    await engine.refresh(TARGET);
    expect(engine.get(TARGET).status).toBe("ready");
    engine.dispose();
  });

  test("unsupported chains and mainnets never reach the reader", async () => {
    let calls = 0;
    const engine = createInspectionEngine(ports({ chains: [{ id: 1, name: "Ethereum", testnet: false }], read: async () => {
      calls++; return { ok: true, value: snapshot() };
    } }));
    await engine.ensure({ ...TARGET, chainId: 1 });
    expect(engine.get({ ...TARGET, chainId: 1 })).toEqual({ status: "error", reason: "Studio doesn't support chain 1 yet." });
    await engine.ensure(TARGET);
    expect(calls).toBe(0);
    engine.dispose();
  });

  test("catalog failure cannot label known bytecode unknown", async () => {
    const engine = createInspectionEngine(ports({ catalogs: async () => ({ ok: false, error: "The catalog couldn't be loaded." }) }));
    await engine.ensure(TARGET);
    expect(engine.get(TARGET)).toEqual({ status: "error", reason: "The catalog couldn't be loaded." });
    engine.dispose();
  });

  test("reverse lookup does not delay inspection and cannot overwrite a refreshed name", async () => {
    const names = [deferred<Result<string | null, string>>(), deferred<Result<string | null, string>>()];
    let calls = 0;
    const engine = createInspectionEngine(ports({ reverseName: () => names[calls++]!.promise }));
    await engine.ensure(TARGET);
    expect(engine.get(TARGET).status).toBe("ready");
    await engine.refresh(TARGET);
    names[1]!.resolve({ ok: true, value: "new.eth" });
    await Promise.resolve();
    names[0]!.resolve({ ok: true, value: "old.eth" });
    await Promise.resolve();
    const state = engine.get(TARGET);
    if (state.status !== "ready") throw new Error("The inspection disappeared.");
    expect(state.value.primaryName).toBe("new.eth");
    engine.dispose();
  });

  test("invalidating or disposing aborts in-flight work without late publication", async () => {
    const read = deferred<Result<DiamondSnapshot, SnapshotReadError>>();
    let signal: AbortSignal | undefined;
    const engine = createInspectionEngine(ports({ read: (_target, next) => { signal = next; return read.promise; } }));
    let notifications = 0;
    const unsubscribe = engine.subscribe(() => { notifications++; });
    const running = engine.ensure(TARGET);
    await Promise.resolve();
    engine.invalidate(TARGET);
    expect(signal?.aborted).toBe(true);
    expect(engine.get(TARGET).status).toBe("idle");
    unsubscribe();
    const before = notifications;
    engine.dispose();
    read.resolve({ ok: true, value: snapshot() });
    await running;
    expect(notifications).toBe(before);
    expect(engine.get(TARGET).status).toBe("idle");
  });

  test("unexpected provider exceptions never expose RPC URLs", async () => {
    const engine = createInspectionEngine(ports({ read: async () => { throw new Error("https://private.example/secret-token"); } }));
    await engine.ensure(TARGET);
    const state = engine.get(TARGET);
    expect(state.status).toBe("error");
    if (state.status === "error") expect(state.reason).not.toContain("secret-token");
    engine.dispose();
  });

  test("refreshed chain and catalog identity invalidates derived call results", async () => {
    let block = 1;
    let currentCatalog = catalog;
    const engine = createInspectionEngine(ports({
      read: async () => ({ ok: true, value: snapshot(block) }),
      catalogs: async () => ({ ok: true, value: [currentCatalog] }),
    }));
    await engine.ensure(TARGET);
    const first = engine.get(TARGET);
    if (first.status !== "ready") throw new Error("No first inspection.");
    block = 2;
    await engine.refresh(TARGET);
    const second = engine.get(TARGET);
    if (second.status !== "ready") throw new Error("No refreshed inspection.");
    expect(second.value.identity).not.toBe(first.value.identity);
    currentCatalog = { ...catalog, hash: `0x${"9".repeat(64)}` as Hex };
    await engine.refresh(TARGET);
    const third = engine.get(TARGET);
    if (third.status !== "ready") throw new Error("No inspection for the new catalog.");
    expect(third.value.snapshot.blockHash).toBe(second.value.snapshot.blockHash);
    expect(third.value.identity).not.toBe(second.value.identity);
    expect(engine.get(TARGET)).toBe(third);
    engine.dispose();
  });
});
