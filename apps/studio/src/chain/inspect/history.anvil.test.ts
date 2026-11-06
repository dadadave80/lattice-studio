import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { summarizeHistory } from "@lattice-studio/core";
import { encodeFunctionData, parseAbi } from "viem";
import { builtCatalog } from "../../../../../e2e-chain/harness/catalog";
import type { Node } from "../../../../../e2e-chain/harness/node";
import { BLANK, coreDeploy, entropyFor, fixture, type DeployPath } from "../../../../../e2e-chain/harness/recipes";
import { localEnv } from "../../../local-env";
import { readCutHistory } from "./history";
import { readDiamondSnapshot } from "./reads";

const base = Number(localEnv("ANVIL_PORT_BASE") ?? "");
const port = base + 8;
const runnable = Number.isInteger(base) && base > 0 && port <= 65535 && Bun.which("anvil") !== null;
const ALICE = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ZERO = "0x0000000000000000000000000000000000000000";
const ABI = parseAbi(["function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] cut,address init,bytes data)"]);

describe.skipIf(!runnable)("cut history on local Anvil", () => {
  const { catalog } = builtCatalog();
  let node: Node | undefined;
  beforeAll(async () => {
    const { startNode } = await import("../../../../../e2e-chain/harness/node");
    const { prepareChain } = await import("../../../../../e2e-chain/harness/prepare");
    node = await startNode({ port });
    await prepareChain(node, catalog, { etch: true });
  }, 120_000);
  afterAll(async () => { await node?.stop(); });

  for (const path of ["factory", "createx"] as const satisfies readonly DeployPath[]) {
    test(`${path}: creation proof and a later cut are read through the exact inspected block`, async () => {
      if (!node) throw new Error("The local Anvil node wasn't started.");
      const { send } = await import("../../../../../e2e-chain/harness/node");
      const recipe = fixture(catalog, BLANK, path, entropyFor(`cut-history-anvil:${path}`));
      const deployment = coreDeploy(recipe, ALICE, node.chainId);
      const created = await send(node, { to: deployment.tx.to, data: deployment.tx.data, gas: 16_777_216n });
      const later = await send(node, { to: deployment.address, data: encodeFunctionData({ abi: ABI, functionName: "diamondCut", args: [[], ZERO, "0x"] }), gas: 1_000_000n });
      const inspected = await readDiamondSnapshot(node.client, deployment.address);
      if (!inspected.ok) throw new Error(inspected.error.reason);
      const options = { fromBlock: 0, toBlock: inspected.value.block, blockHash: inspected.value.blockHash };
      const result = await readCutHistory(node.client, deployment.address, options, { catalogs: [catalog] });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.reason);
      expect(result.value.coverage).toBe("full");
      expect(result.value.deployment).toMatchObject({ txHash: created.transactionHash, block: Number(created.blockNumber), via: path === "factory" ? "LatticeFactory" : "CreateX" });
      const grouped = summarizeHistory(result.value.history);
      expect(grouped.deploymentTx).toBe(created.transactionHash);
      expect(grouped.later.map((event) => event.txHash)).toEqual([later.transactionHash]);
      expect(grouped.later[0]?.cuts).toEqual([]);
      const range = await readCutHistory(node.client, deployment.address, { ...options, fromBlock: Number(later.blockNumber) }, { catalogs: [catalog] });
      if (!range.ok) throw new Error(range.error.reason);
      expect(range.value.coverage).toBe("range");
      expect(range.value.deployment).toBeNull();
    }, 60_000);
  }
});
