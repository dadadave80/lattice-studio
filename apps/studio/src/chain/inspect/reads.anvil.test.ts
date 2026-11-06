import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Address } from "@lattice-studio/core";
import { getBlock } from "viem/actions";
import { builtCatalog } from "../../../../../e2e-chain/harness/catalog";
import type { Node } from "../../../../../e2e-chain/harness/node";
import { coreDeploy, entropyFor, fixture } from "../../../../../e2e-chain/harness/recipes";
import { localEnv } from "../../../local-env";
import { createInspectionEngine } from "./engine";
import { readDiamondSnapshot } from "./reads";

// Reserve a separate slot from the existing deploy/probe suites on the worktree's local port range.
const base = Number(localEnv("ANVIL_PORT_BASE") ?? "");
const port = base + 6;
const runnable = Number.isInteger(base) && base > 0 && port <= 65535 && Bun.which("anvil") !== null;
const ALICE: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const NO_CODE: Address = "0x00000000000000000000000000000000000000AA";

describe.skipIf(!runnable)("diamond inspection on local Anvil", () => {
  const { catalog } = builtCatalog();
  let node: Node | undefined;
  let diamond: Address;
  let deployedBlock: bigint;
  const recipe = fixture(catalog, "ERC20", "factory", entropyFor("inspection-real-anvil-erc20"));

  beforeAll(async () => {
    // Keep prool and the chain harness out of skipped pure-test runs.
    const { send, startNode } = await import("../../../../../e2e-chain/harness/node");
    const { prepareChain } = await import("../../../../../e2e-chain/harness/prepare");
    node = await startNode({ port });
    await prepareChain(node, catalog, { etch: true });
    const deployment = coreDeploy(recipe, ALICE, node.chainId);
    const receipt = await send(node, { to: deployment.tx.to, data: deployment.tx.data, gas: 16_777_216n });
    diamond = deployment.address;
    deployedBlock = receipt.blockNumber;
  }, 120_000);

  afterAll(async () => {
    await node?.stop();
  });

  test("reads a real factory diamond at a hash-pinned block and identifies it through the engine", async () => {
    if (!node) throw new Error("The local Anvil node wasn't started.");
    const snapshot = await readDiamondSnapshot(node.client, diamond);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) throw new Error(`${snapshot.error.kind}: ${snapshot.error.reason}`);
    expect(snapshot.value.block).toBe(Number(deployedBlock));
    const block = await getBlock(node.client, { blockNumber: BigInt(snapshot.value.block) });
    expect(snapshot.value.blockHash).toBe(block.hash);
    expect(snapshot.value.code).not.toBe("0x");
    expect(snapshot.value.loupeError).toBeUndefined();
    const actual = snapshot.value.facets?.flatMap((row) => row.functionSelectors.map((selector) => `${selector}:${row.facetAddress.toLowerCase()}`)).sort();
    const desired = recipe.analysis.plan.flatMap((row) => row.selectors.map((selector) => `${selector}:${row.address.toLowerCase()}`)).sort();
    expect(actual).toEqual(desired);
    for (const row of recipe.analysis.plan) {
      const release = catalog.facets.find((facet) => facet.name === row.facet)?.release;
      expect(snapshot.value.codehashes[row.address.toLowerCase()]).toBe(release?.codehash);
    }

    const engine = createInspectionEngine({
      chains: [{ id: node.chainId, name: "Anvil", testnet: true }],
      read: (target, signal) => readDiamondSnapshot(node!.client, target.address, signal),
      catalogs: async () => ({ ok: true, value: [catalog] }),
    });
    try {
      const target = { chainId: node.chainId, address: diamond };
      await engine.ensure(target);
      const state = engine.get(target);
      expect(state.status).toBe("ready");
      if (state.status !== "ready") throw new Error("The factory diamond wasn't ready for inspection.");
      expect(state.value.snapshot.blockHash).toBe(snapshot.value.blockHash);
      expect(state.value.facets.every((facet) => facet.kind === "known")).toBe(true);
      expect(state.value.facets.some((facet) => facet.name === "ERC20")).toBe(true);
      expect(state.value.passport.claims.filter((claim) => ["PP-01", "PP-02", "PP-03"].includes(claim.id)).map((claim) => claim.status)).toEqual(["pass", "pass", "pass"]);

      const empty = { chainId: node.chainId, address: NO_CODE };
      await engine.ensure(empty);
      expect(engine.get(empty).status).toBe("no-code");
      const erc20 = catalog.facets.find((facet) => facet.name === "ERC20");
      if (!erc20) throw new Error("The catalog has no ERC20 release.");
      const facet = { chainId: node.chainId, address: erc20.release.address };
      await engine.ensure(facet);
      expect(engine.get(facet).status).toBe("not-diamond");
    } finally {
      engine.dispose();
    }
  }, 60_000);
});
