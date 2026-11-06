import { describe, expect, test } from "bun:test";
import type { Address, Result } from "@lattice-studio/core";
import { makeCatalog } from "@lattice-studio/core/testing";
import { fakeChainService } from "../../../test/harness/chain";
import { createInspectionApp } from "./app";
import { resetForProjectSwitch } from "@/projects/cmd/shared";

const ADDRESS: Address = "0x00000000000000000000000000000000000000aa";
const OTHER: Address = "0x00000000000000000000000000000000000000bb";
const catalog = makeCatalog();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function rig() {
  const chain = fakeChainService({ catalog, ens: { "token.eth": ADDRESS } });
  const shown: { chainId: number; address: Address }[] = [];
  const app = createInspectionApp({
    chains: chain.chains(), chain: async () => chain,
    catalogs: async () => ({ ok: true, value: [catalog] }),
    show: (target) => { shown.push(target); },
  });
  return { chain, shown, app };
}

describe("inspection app runtime", () => {
  test("malformed embedded ENS targets never resolve or echo URL credentials", async () => {
    const { chain, shown, app } = rig();
    const secret = "https://private.example/rpc?key=secret-token";
    const result = await app.open({ target: `#d=11155111:${encodeURIComponent(secret)}` });
    expect(result).toEqual({ ok: false, error: "Enter a valid diamond address or ENS name." });
    expect(chain.calls.filter((call) => call.method !== "chains")).toEqual([]);
    expect(shown).toEqual([]);
    app.dispose();
  });

  test("a successful project switch cancels an earlier unresolved inspection", async () => {
    const { chain, shown, app } = rig();
    const name = deferred<Result<Address | null, string>>();
    chain.resolveEns = () => name.promise;
    const first = app.open({ target: "11155111:slow.eth" });
    await Promise.resolve();
    resetForProjectSwitch();
    name.resolve({ ok: true, value: ADDRESS });
    expect((await first).ok).toBe(false);
    expect(shown).toEqual([]);
    app.dispose();
  });
  test("opens an explicit target before its snapshot settles without changing the composition", async () => {
    const { chain, shown, app } = rig();
    chain.inspectDiamond = () => new Promise<never>(() => {});
    const result = await app.open({ target: `11155111:${ADDRESS}` });
    expect(result.ok).toBe(true);
    expect(shown).toEqual([{ chainId: 11155111, address: "0x00000000000000000000000000000000000000AA" }]);
    expect(app.engine.get(shown[0]!).status).toBe("loading");
    app.dispose();
  });

  test("bare route input has no implicit chain, and mainnet never resolves or reads", async () => {
    const { chain, shown, app } = rig();
    expect((await app.open({ target: ADDRESS })).ok).toBe(false);
    expect((await app.open({ target: `1:${ADDRESS}` })).ok).toBe(false);
    expect(shown).toEqual([]);
    expect(chain.calls.filter((call) => call.method !== "chains")).toEqual([]);
    app.dispose();
  });

  test("resolves a name on its explicit chain and refuses invalid addresses or missing records", async () => {
    const { chain, shown, app } = rig();
    expect((await app.open({ target: "token.eth", chainId: 84532 })).ok).toBe(true);
    expect(shown[0]?.chainId).toBe(84532);
    expect(chain.calls.find((call) => call.method === "resolveEns")?.args).toEqual(["token.eth", 84532]);
    expect((await app.open({ target: "0xinvalid", chainId: 11155111 })).ok).toBe(false);
    expect((await app.open({ target: "missing.eth", chainId: 11155111 })).ok).toBe(false);
    expect(shown).toHaveLength(1);
    app.dispose();
  });

  test("a later open wins over stale ENS resolution", async () => {
    const { chain, shown, app } = rig();
    const name = deferred<Result<Address | null, string>>();
    chain.resolveEns = () => name.promise;
    const first = app.open({ target: "slow.eth", chainId: 11155111 });
    await Promise.resolve();
    expect((await app.open({ target: OTHER, chainId: 84532 })).ok).toBe(true);
    name.resolve({ ok: true, value: ADDRESS });
    expect((await first).ok).toBe(false);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.chainId).toBe(84532);
    app.dispose();
  });

  test("aborted resolution never routes, and provider exceptions do not reveal endpoint secrets", async () => {
    const { chain, shown, app } = rig();
    const name = deferred<Result<Address | null, string>>();
    chain.resolveEns = () => name.promise;
    const abort = new AbortController();
    const opening = app.open({ target: "slow.eth", chainId: 11155111 }, abort.signal);
    await Promise.resolve();
    abort.abort();
    name.resolve({ ok: true, value: ADDRESS });
    expect((await opening).ok).toBe(false);
    expect(shown).toEqual([]);
    chain.resolveEns = async () => { throw new Error("https://private.example/secret-token"); };
    const failed = await app.open({ target: "token.eth", chainId: 11155111 });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).not.toContain("secret-token");
    app.dispose();
  });
});
