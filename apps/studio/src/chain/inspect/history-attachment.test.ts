import { describe, expect, test } from "bun:test";
import { makeCatalog } from "@lattice-studio/core/testing";
import type { DiamondCutHistory } from "@/contracts/chain";
import { createInspectionEngine } from "./engine";

const target = { chainId: 11155111, address: "0x00000000000000000000000000000000000000AA" } as const;
const hash = `0x${"ab".repeat(32)}` as const;

describe("verified history attachment", () => {
  test("updates passport claims while preserving observed snapshot, facet and call identities", async () => {
    const engine = createInspectionEngine({ chains: [{ id: target.chainId, name: "Sepolia", testnet: true }],
      read: async () => ({ ok: true, value: { block: 5, blockHash: hash, code: "0x6000", facets: [], codehashes: {}, ownerRouted: false, owner: null } }),
      catalogs: async () => ({ ok: true, value: [makeCatalog()] }),
    });
    await engine.ensure(target);
    const before = engine.get(target);
    if (before.status !== "ready") throw new Error("No inspection.");
    const history: DiamondCutHistory = { chainId: target.chainId, address: target.address, history: [{ block: 2, logIndex: 0, txHash: hash, init: target.address, cuts: [] }], source: "rpc", fromBlock: 0, toBlock: 5, blockHash: hash, coverage: "full", deployment: { txHash: hash, block: 2, from: target.address, to: null, via: "other" } };
    expect(engine.attachHistory(target, { ...history, chainId: 84532 }, before.value.identity)).toBe(false);
    expect(engine.attachHistory(target, { ...history, coverage: "range" }, before.value.identity)).toBe(false);
    expect(engine.attachHistory(target, { ...history, deployment: null }, before.value.identity)).toBe(false);
    expect(engine.attachHistory(target, history, "different-catalog-or-observation")).toBe(false);
    expect(engine.attachHistory(target, history, before.value.identity)).toBe(true);
    const after = engine.get(target);
    if (after.status !== "ready") throw new Error("The observation was lost.");
    expect(after.value.identity).toBe(before.value.identity);
    expect(after.value.snapshot).toBe(before.value.snapshot);
    expect(after.value.facets).toBe(before.value.facets);
    expect(after.value.passport.digest).not.toBe(before.value.passport.digest);
    expect(after.value.passport.history).toEqual(history.history);
    expect(after.value.passport.source.logs).toBe("rpc");
    expect(after.value.passport.claims.find((claim) => claim.id === "PP-06")?.status).toBe("pass");
    engine.dispose();
  });
});
