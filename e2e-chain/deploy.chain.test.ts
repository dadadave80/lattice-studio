/**
 * The deploy transaction core builds (C4b `encodeInit`, C5b predictions, C5c `buildDiamondDeploy`), sent with viem
 * to a local Anvil node through LatticeFactory and through CreateX's real code: the diamond lands at the predicted
 * address and its loupe matches the plan (spec L934-L935 Fork row). Forced failures decode to the right module and
 * error through C6's `decodeRevert`: an init revert through the factory, the same one wrapped by CreateX, and an
 * init that reverts with no reason (Arachnid's reasonless reverts are in shared.chain.test.ts).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { decodeEventLog, type Address, type Hex } from "viem";
import {
  LATTICE_FACTORY_ABI, analyze, decodeInit, decodeRevert, type Arg, type DecodedRevert, type RevertContext,
} from "@lattice-studio/core";
import { builtCatalog, revertDetails } from "./harness/catalog";
import { ANVIL_SKIP_REASON, PORT, anvilPort, announceSkip } from "./harness/env";
import { compareLoupe, loupeSummary } from "./harness/loupe";
import { ALICE, BOB, send, startNode, type Node } from "./harness/node";
import { prepareChain } from "./harness/prepare";
import { PATHS, coreDeploy, entropyFor, fixture, predict, v1Recipes, type DeployPath, type Fixture } from "./harness/recipes";
import { ResultTable } from "./harness/report";
import { GAS_CAP, chainState } from "./harness/shared";

announceSkip("core-built deploys", ANVIL_SKIP_REASON);

describe.skipIf(ANVIL_SKIP_REASON !== undefined)("the deploy calldata core builds, sent with viem", () => {
  const { catalog } = builtCatalog();
  const table = new ResultTable("Core-built deploy calldata on Anvil (viem)");
  let node: Node;

  beforeAll(async () => {
    node = await startNode({ port: anvilPort(PORT.deploy) });
    await prepareChain(node, catalog, { etch: true });
  }, 120_000);

  afterAll(async () => {
    table.print();
    await node?.stop();
  });

  /** What `decodeRevert` gets in the app: every shard, the placed facets, the path and the decoded init. */
  function context(f: Fixture, path: DeployPath, init: { data: Hex }, refs: { self: Address; deployer: Address }): RevertContext {
    const decoded = decodeInit(init.data, catalog, refs);
    return { details: revertDetails(), placed: f.recipe.facets, path, ...(decoded.ok ? { init: decoded.value } : {}) };
  }

  /** Sends the deploy's calldata as an `eth_call` first and returns the revert bytes (the deploy must fail). */
  async function revertOf(f: Fixture, from: Address): Promise<{ decoded: DecodedRevert; address: Address }> {
    const deploy = coreDeploy(f, from, node.chainId);
    const preview = await node.call({ from, to: deploy.tx.to, data: deploy.tx.data, gas: GAS_CAP });
    expect(preview.ok).toBe(false);
    return {
      decoded: decodeRevert(preview.data, catalog, context(f, f.project.deploy.path, deploy.init, { self: deploy.address, deployer: from })),
      address: deploy.address,
    };
  }

  test("the catalog has v1 recipes to run", () => {
    expect(v1Recipes(catalog).length).toBeGreaterThan(0);
  });

  for (const name of v1Recipes(catalog)) {
    for (const path of PATHS) {
      test(`${name} through ${path === "factory" ? "LatticeFactory" : "CreateX"}: lands at the prediction, loupe matches the plan`, async () => {
        const f = fixture(catalog, name, path, entropyFor(`viem:${name}:${path}`));
        await table.run(name, path, async () => {
          const deploy = coreDeploy(f, ALICE, node.chainId);
          // The chain is ready: no NET problem blocks this deploy (NET-01 on CreateX's real code included).
          const netProblems = analyze(f.recipe, catalog, {
            known: [],
            unconfirmed: [],
            deploy: { chainId: node.chainId, path, from: ALICE, salt: predict(f, ALICE, node.chainId).salt },
            chain: await chainState(node, catalog),
          }).problems.filter((p) => p.code.startsWith("NET-") && p.severity === "blocker");
          expect(netProblems).toEqual([]);
          expect(await node.rpc<Hex>("eth_getCode", [deploy.address, "latest"])).toBe("0x");
          const receipt = await send(node, { from: ALICE, to: deploy.tx.to, data: deploy.tx.data, gas: GAS_CAP });
          expect(await node.rpc<Hex>("eth_getCode", [deploy.address, "latest"])).not.toBe("0x");
          const comparison = await compareLoupe(node, deploy.address, f.analysis.plan);
          expect(comparison).toEqual({ matches: true, missing: [], extra: [], moved: [] });
          if (path === "factory") {
            const events = receipt.logs
              .filter((log) => log.address.toLowerCase() === deploy.tx.to.toLowerCase())
              .map((log) => decodeEventLog({ abi: LATTICE_FACTORY_ABI, data: log.data, topics: log.topics }));
            expect(events.map((e) => [e.eventName, (e.args as { diamond: Address }).diamond])).toEqual([["DiamondDeployed", deploy.address]]);
          }
          return { receipt, deploy };
        }, ({ receipt }) => `pass: ${loupeSummary(f.analysis.plan)}, gas ${receipt.gasUsed}`);
      }, 60_000);
    }
  }

  test("a repeat (sender, salt) at LatticeFactory returns the existing diamond without DiamondDeployed; comparePlan catches another recipe", async () => {
    const entropy = entropyFor("repeat");
    const first = fixture(catalog, "ERC20", "factory", entropy);
    const deploy = coreDeploy(first, BOB, node.chainId);
    await send(node, { from: BOB, to: deploy.tx.to, data: deploy.tx.data, gas: GAS_CAP });
    const again = await send(node, { from: BOB, to: deploy.tx.to, data: deploy.tx.data, gas: GAS_CAP });
    expect(again.logs.filter((log) => log.address.toLowerCase() === deploy.tx.to.toLowerCase())).toEqual([]);
    expect((await compareLoupe(node, deploy.address, first.analysis.plan)).matches).toBe(true);
    // Another recipe with the same sender and salt lands on the ERC20 diamond: the receipt succeeds, the loupe doesn't match.
    const other = fixture(catalog, "SafeDiamondCut", "factory", entropy);
    const otherDeploy = coreDeploy(other, BOB, node.chainId);
    expect(otherDeploy.address).toBe(deploy.address);
    const receipt = await send(node, { from: BOB, to: otherDeploy.tx.to, data: otherDeploy.tx.data, gas: GAS_CAP });
    expect(receipt.logs.filter((log) => log.address.toLowerCase() === deploy.tx.to.toLowerCase())).toEqual([]);
    const comparison = await compareLoupe(node, deploy.address, other.analysis.plan);
    expect(comparison.matches).toBe(false);
    expect(comparison.missing.length).toBeGreaterThan(0);
  }, 60_000);

  test("a used salt on CreateX reverts FailedContractCreation; the decoder says to check the salt's addresses, which hold the diamond", async () => {
    const f = fixture(catalog, "ERC20", "createx", entropyFor("createx-repeat"));
    const deploy = coreDeploy(f, BOB, node.chainId);
    await send(node, { from: BOB, to: deploy.tx.to, data: deploy.tx.data, gas: GAS_CAP });
    const { decoded, address } = await revertOf(f, BOB);
    expect(decoded.module).toBe("CreateX");
    expect(decoded.error).toBe("FailedContractCreation");
    expect(decoded.hint).toContain("check the salt's addresses for code");
    expect(await node.rpc<Hex>("eth_getCode", [address, "latest"])).not.toBe("0x");
  }, 60_000);

  describe("forced failures decode to the module and error", () => {
    const tooHigh: Record<string, Arg> = { minThreshold: "3" };

    for (const path of PATHS) {
      test(`an init revert through ${path === "factory" ? "LatticeFactory" : "CreateX"} names SafeDiamondCut's error`, async () => {
        // The stand-in Safe's threshold is 2; the init asks for at least 3 (INIT-01 would block it in the app).
        const f = fixture(catalog, "SafeDiamondCut", path, entropyFor(`threshold:${path}`), tooHigh, { allowBlockers: true });
        const { decoded, address } = await revertOf(f, ALICE);
        expect(decoded.error).toBe("SafeDiamondCutThresholdTooLow");
        expect(decoded.module).toBe("SafeDiamondCut");
        expect(decoded.args.map((a) => a.value)).toEqual(["2", "3"]);
        expect(decoded.wrappers).toEqual(path === "createx" ? ["FailedContractInitialisation"] : []);
        expect(await node.rpc<Hex>("eth_getCode", [address, "latest"])).toBe("0x");
        table.record("SafeDiamondCut (min threshold 3)", path, `reverts as expected: ${[...decoded.wrappers, `${decoded.module}.${decoded.error}`].join(" > ")}`);
      }, 60_000);
    }

    test("a revert inside a bundle names the module whose error it is, not the init", async () => {
      const f = fixture(catalog, "GovernedVault", "createx", entropyFor("quorum"), { quorumNumerator: "140" }, { allowBlockers: true });
      const { decoded } = await revertOf(f, ALICE);
      expect(decoded.wrappers).toEqual(["FailedContractInitialisation"]);
      expect(decoded.error).toBe("GovernorInvalidQuorumFraction");
      expect(decoded.module).toBe("Governor");
      expect(decoded.args.map((a) => a.value)).toEqual(["140", "100"]);
      table.record("GovernedVault (quorum 140)", "createx", `reverts as expected: ${[...decoded.wrappers, `${decoded.module}.${decoded.error}`].join(" > ")}`);
    }, 60_000);

    test("an init that reverts with no reason comes back wrapped, with the call to replay", async () => {
      // A Safe address with no code: `getThreshold()` reverts with no data, so DiamondLib wraps it.
      const f = fixture(catalog, "SafeDiamondCut", "factory", entropyFor("no-safe"), { safe: "0x000000000000000000000000000000000000dEaD" }, { allowBlockers: true });
      const { decoded } = await revertOf(f, ALICE);
      expect(decoded.error).toBe("");
      expect(decoded.wrappers).toEqual(["InitializeDiamondCutReverted"]);
      expect(decoded.module).toBe("SafeDiamondCutInit");
      expect(decoded.hint).toBe("`SafeDiamondCutInit.init(address,address,uint256)` reverted without a reason: replay it with `eth_call` to see where it failed.");
      table.record("SafeDiamondCut (no Safe)", "factory", `reverts as expected: ${decoded.wrappers.join(" > ")} (no reason)`);
    }, 60_000);
  });
});
