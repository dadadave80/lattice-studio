/**
 * Deploying the missing shared contracts through Arachnid's proxy (spec L934-L935 Fork row, Flow 12 step 3, R21)
 * with the transactions C5c builds: one per contract, and batched through Multicall3's real `aggregate3` with
 * failures allowed. Every contract lands at its release address with the catalog's codehash (NET-04's condition),
 * and the proxy's reasonless reverts are diagnosed by a code check and an `eth_call` replay.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { concat, encodeFunctionData, getAddress, keccak256, type Hex } from "viem";
import {
  ARACHNID_PROXY, ARACHNID_PROXY_CODEHASH, MULTICALL3, MULTICALL3_ABI, arachnidAddress, decodeRevert, sharedSalt, type Catalog,
} from "@lattice-studio/core";
import { builtCatalog, creationCode, neededFor, revertDetails, sharedContracts } from "./harness/catalog";
import { diagnoseArachnid } from "./harness/diagnose";
import { ANVIL_SKIP_REASON, PORT, anvilPort, announceSkip } from "./harness/env";
import { ALICE, BOB, send, startNode, type Node } from "./harness/node";
import { PATHS, entropyFor, fixture, v1Recipes } from "./harness/recipes";
import { GAS_CAP, chainState, deployMissing } from "./harness/shared";
import { etchVendored } from "./harness/vendor";

announceSkip("shared contracts", ANVIL_SKIP_REASON);

/** A constructor that reverts with no data: PUSH1 0, PUSH1 0, REVERT. */
const REVERTING_CREATION: Hex = "0x60006000fd";

/** Every shared contract the v1 recipes need on either path. */
function neededByV1(catalog: Catalog): string[] {
  const names = new Set<string>();
  for (const name of v1Recipes(catalog)) {
    for (const path of PATHS) {
      const f = fixture(catalog, name, path, entropyFor(name));
      for (const n of neededFor(catalog, f.recipe, f.analysis.plan, path)) names.add(n);
    }
  }
  return [...names];
}

describe.skipIf(ANVIL_SKIP_REASON !== undefined)("shared contracts through Arachnid's proxy", () => {
  const { catalog } = builtCatalog();
  let node: Node;
  let fresh: Hex;

  beforeAll(async () => {
    node = await startNode({ port: anvilPort(PORT.shared) });
    await etchVendored(node);
    fresh = await node.client.snapshot();
  }, 60_000);

  afterAll(async () => {
    await node?.stop();
  });

  test("Anvil has Arachnid's proxy with the codehash the catalog pins", async () => {
    const state = await chainState(node, catalog);
    expect(state.deployer).toEqual({ present: true, codehash: ARACHNID_PROXY_CODEHASH });
    expect(catalog.deployer.codehash).toBe(ARACHNID_PROXY_CODEHASH);
  });

  test("one transaction each: every contract the v1 recipes need lands at its release address with the catalog codehash", async () => {
    await node.client.revert({ id: fresh });
    fresh = await node.client.snapshot();
    const names = neededByV1(catalog);
    const report = await deployMissing(node, catalog, names, "transactions");
    expect(report.plan.mode).toBe("transactions");
    expect(report.plan.txs.every((t) => t.tx.to === ARACHNID_PROXY && t.names.length === 1)).toBe(true);
    // The proxy returns the created address as 20 raw bytes, not ABI-encoded.
    for (const r of report.results) {
      const item = sharedContracts(catalog).find((s) => s.name === r.names[0]);
      expect([r.names[0], r.entries[0]?.returnData]).toEqual([r.names[0], item?.release.address.toLowerCase() as Hex]);
    }
    const after = await chainState(node, catalog);
    for (const name of names) {
      const release = sharedContracts(catalog).find((s) => s.name === name)?.release;
      expect([name, after.shared[name]]).toEqual([name, { present: true, codehash: release?.codehash.toLowerCase() as Hex }]);
    }
    // Running it again deploys nothing: every name is skipped.
    const again = await deployMissing(node, catalog, names, "transactions");
    expect(again.plan.txs).toEqual([]);
    expect(new Set(again.plan.skipped)).toEqual(new Set(names));
  }, 120_000);

  test("Multicall3 batches under the gas cap: aggregate3 returns each address as 20 raw bytes, codehashes match", async () => {
    await node.client.revert({ id: fresh });
    fresh = await node.client.snapshot();
    const names = neededByV1(catalog);
    const report = await deployMissing(node, catalog, names, "multicall");
    expect(report.plan.mode).toBe("multicall");
    expect(report.plan.txs.some((t) => t.tx.to === MULTICALL3 && t.names.length > 1)).toBe(true);
    for (const r of report.results) {
      r.names.forEach((name, i) => {
        const release = sharedContracts(catalog).find((s) => s.name === name)?.release;
        const entry = r.entries[i];
        expect([name, entry?.success, entry?.returnData]).toEqual([name, true, release?.address.toLowerCase() as Hex]);
      });
    }
    const after = await chainState(node, catalog);
    for (const name of names) {
      const release = sharedContracts(catalog).find((s) => s.name === name)?.release;
      expect([name, after.shared[name]?.codehash]).toEqual([name, release?.codehash.toLowerCase() as Hex]);
    }
  }, 120_000);

  test("every shared contract in the catalog deploys at its release address with the catalog codehash", async () => {
    await node.client.revert({ id: fresh });
    fresh = await node.client.snapshot();
    const names = sharedContracts(catalog).map((s) => s.name);
    await deployMissing(node, catalog, names, "multicall");
    const after = await chainState(node, catalog);
    const wrong = sharedContracts(catalog)
      .filter((s) => after.shared[s.name]?.codehash !== s.release.codehash.toLowerCase())
      .map((s) => `${s.name}: ${after.shared[s.name]?.codehash ?? "no code"}`);
    expect(wrong).toEqual([]);
  }, 240_000);

  test("one failed contract in an aggregate3 batch doesn't undo the others; the failure is diagnosed by code check and replay", async () => {
    await node.client.revert({ id: fresh });
    fresh = await node.client.snapshot();
    const ok = catalog.facets[0];
    if (ok === undefined) throw new Error("catalog has no facets");
    const okCode = creationCode([ok.name])[ok.name] ?? "0x";
    const badSalt = sharedSalt("Reverting", "0.0.1");
    const data = encodeFunctionData({
      abi: MULTICALL3_ABI,
      functionName: "aggregate3",
      args: [
        [
          { target: ARACHNID_PROXY, allowFailure: true, callData: concat([badSalt, REVERTING_CREATION]) },
          { target: ARACHNID_PROXY, allowFailure: true, callData: concat([ok.release.salt, okCode]) },
        ],
      ],
    });
    await send(node, { from: BOB, to: MULTICALL3, data, gas: GAS_CAP });
    // The good one landed.
    expect(await diagnoseArachnid(node, ok.release.salt, okCode)).toEqual({
      status: "deployed",
      address: getAddress(ok.release.address),
      codehash: ok.release.codehash.toLowerCase() as Hex,
    });
    // The bad one: no code at its address, and the replay reverts with no reason, which the decoder says how to read.
    const bad = await diagnoseArachnid(node, badSalt, REVERTING_CREATION);
    expect(bad.status).toBe("failed");
    if (bad.status !== "failed") return;
    expect(bad.address).toBe(arachnidAddress(badSalt, keccak256(REVERTING_CREATION)));
    expect(bad.replay).toEqual({ ok: false, data: "0x" });
    const decoded = decodeRevert(bad.replay.data, catalog, { details: revertDetails() });
    expect(decoded.error).toBe("");
    expect(decoded.module).toBeNull();
    expect(decoded.hint).toContain("check the target address for code, then replay the call with `eth_call`");
  }, 60_000);

  test("a repeat deploy is a reasonless revert too: the code check finds the contract already there", async () => {
    await node.client.revert({ id: fresh });
    fresh = await node.client.snapshot();
    const facet = catalog.facets[1];
    if (facet === undefined) throw new Error("catalog has too few facets");
    const code = creationCode([facet.name])[facet.name] ?? "0x";
    const calldata = concat([facet.release.salt, code]);
    await send(node, { from: ALICE, to: ARACHNID_PROXY, data: calldata, gas: GAS_CAP });
    // CREATE2 collides, the proxy reverts with no data.
    expect(await node.call({ to: ARACHNID_PROXY, data: calldata, gas: GAS_CAP })).toEqual({ ok: false, data: "0x" });
    expect(await diagnoseArachnid(node, facet.release.salt, code)).toEqual({
      status: "deployed",
      address: getAddress(facet.release.address),
      codehash: facet.release.codehash.toLowerCase() as Hex,
    });
  }, 60_000);
});
