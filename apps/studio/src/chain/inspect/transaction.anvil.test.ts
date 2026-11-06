import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Address } from "@lattice-studio/core";
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import { builtCatalog } from "../../../../../e2e-chain/harness/catalog";
import type { Node } from "../../../../../e2e-chain/harness/node";
import { coreDeploy, entropyFor, fixture } from "../../../../../e2e-chain/harness/recipes";
import { localEnv } from "../../../local-env";
import { createViemPort } from "../deploy/viem-port";
import { readOnchainCall } from "./call";
import { readDiamondSnapshot } from "./reads";
import type { DiamondSnapshot } from "./snapshot";
import { createTransactionController } from "./transaction";
import { authorizeKnownOwner } from "./transaction-owner";

const base = Number(localEnv("ANVIL_PORT_BASE") ?? "");
const port = base + 7;
const runnable = Number.isInteger(base) && base > 0 && port <= 65535 && Bun.which("anvil") !== null;
const ALICE: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BOB: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ABI = parseAbi(["function approve(address spender,uint256 amount) returns (bool)", "function allowance(address owner,address spender) view returns (uint256)"]);

describe.skipIf(!runnable)("generic transaction lifecycle on local Anvil", () => {
  const { catalog } = builtCatalog();
  let node: Node | undefined;
  let diamond: Address;

  beforeAll(async () => {
    const { send, startNode } = await import("../../../../../e2e-chain/harness/node");
    const { prepareChain } = await import("../../../../../e2e-chain/harness/prepare");
    node = await startNode({ port });
    await prepareChain(node, catalog, { etch: true });
    const recipe = fixture(catalog, "ERC20", "factory", entropyFor("generic-transaction-anvil-erc20"));
    const deployed = coreDeploy(recipe, ALICE, node.chainId);
    await send(node, { to: deployed.tx.to, data: deployed.tx.data, gas: 16_777_216n });
    diamond = deployed.address;
  }, 120_000);

  afterAll(async () => { await node?.stop(); });

  test("a non-owner reviews an exact approve call, explicitly signs, sees its receipt and reads new allowance", async () => {
    if (!node) throw new Error("The local Anvil node wasn't started.");
    const local = node;
    const { chainState } = await import("../../../../../e2e-chain/harness/shared");
    const before = await readDiamondSnapshot(local.client, diamond);
    if (!before.ok) throw new Error(before.error.reason);
    const port = createViemPort({
      service: {
        chains: () => [{ id: local.chainId, name: "Anvil", testnet: true }],
        account: () => ({ address: BOB, chainId: local.chainId, connector: "anvil" }),
        probe: async () => ({ ok: true, value: await chainState(local, catalog) }),
        codeAt: async () => ({ ok: false, error: "Unused by a generic transaction." }),
        readFacets: async () => ({ ok: false, error: "Unused by a generic transaction." }),
      },
      client: () => local.client,
      wallet: {
        send: async (_chainId, request) => ({ kind: "sent", value: await local.client.sendTransaction({ account: request.from, ...request.tx, ...(request.gas === undefined ? {} : { gas: request.gas }), chain: null }) }),
        atomicBatch: async () => false, sendCalls: async () => ({ kind: "rejected" }), waitCalls: async () => ({ kind: "aborted" }),
      },
      noteEstimate: () => {}, pollInterval: 25,
    });
    let refreshed: DiamondSnapshot | null = null;
    const controller = createTransactionController({
      chains: [{ id: local.chainId, testnet: true }], chain: async () => port,
      inspect: (_chainId, address, signal) => readDiamondSnapshot(local.client, address, signal),
      context: () => ({ key: "captured-project", online: true, readOnly: null }), subscribe: () => () => {},
      clock: { now: () => Date.now(), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
      receiptTimeout: () => 10,
      authorize: async (review, snapshot) => authorizeKnownOwner(review, snapshot, [catalog]),
      onSuccess: async () => { const next = await readDiamondSnapshot(local.client, diamond); if (!next.ok) throw new Error(next.error.reason); refreshed = next.value; },
    });
    try {
      const allowanceData = encodeFunctionData({ abi: ABI, functionName: "allowance", args: [BOB, ALICE] });
      const initial = await readOnchainCall(local.client, diamond, allowanceData, { blockHash: before.value.blockHash });
      if (!initial.ok) throw new Error(initial.error.reason);
      expect(decodeFunctionResult({ abi: ABI, functionName: "allowance", data: initial.value })).toBe(0n);
      await controller.review({ chainId: local.chainId, tx: { to: diamond, data: encodeFunctionData({ abi: ABI, functionName: "approve", args: [ALICE, 23n] }), value: 0n }, snapshot: before.value });
      expect(controller.get().phase).toBe("ready");
      expect(controller.get().hash).toBeUndefined();
      expect(controller.get().review?.from).toBe(BOB);
      await controller.sign();
      const deadline = Date.now() + 10_000;
      while (controller.get().phase !== "confirmed" || controller.get().verificationPending) {
        if (Date.now() >= deadline || controller.get().phase === "failed") throw new Error(controller.get().error ?? "The transaction didn't confirm.");
        await Bun.sleep(25);
      }
      const observed = refreshed as DiamondSnapshot | null;
      expect(observed).not.toBeNull();
      if (!observed) throw new Error("The confirmed call didn't refresh inspection.");
      const receipt = controller.get().receipt;
      if (!receipt) throw new Error("The confirmed call has no receipt.");
      expect(observed.block).toBe(receipt.block);
      expect(observed.block).toBeGreaterThan(before.value.block);
      const after = await readOnchainCall(local.client, diamond, allowanceData, { blockHash: observed.blockHash });
      if (!after.ok) throw new Error(after.error.reason);
      expect(decodeFunctionResult({ abi: ABI, functionName: "allowance", data: after.value })).toBe(23n);
    } finally { controller.dispose(); }
  }, 30_000);
});
