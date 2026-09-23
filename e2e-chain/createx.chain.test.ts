/**
 * CreateX parity (deferred from C5b, whose mirror was checked only against Lattice's MockCreateX): with CreateX's
 * real runtime code etched (codehash 0xbd8a7ea8…b53f), core's `createxPredict` equals where `deployCreate3`
 * actually lands and what CreateX's own `computeCreate3Address` says, for both scope flags and two chain ids. NET-01
 * passes on that code and fails on the mock's.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, type Address, type Hex } from "viem";
import { CREATEX, analyze, buildSalt, createxPredict, type ChainState, type Scope } from "@lattice-studio/core";
import mockFixture from "../packages/core/src/address/fixtures/lattice-f4a32c8.json";
import { builtCatalog } from "./harness/catalog";
import { ANVIL_SKIP_REASON, PORT, anvilPort, announceSkip } from "./harness/env";
import { ALICE, BOB, send, startNode, withChainId, type Node } from "./harness/node";
import { entropyFor, fixture } from "./harness/recipes";
import { chainState } from "./harness/shared";
import { CREATEX_CODEHASH, MULTICALL3_CODEHASH, etchVendored, vendoredCode } from "./harness/vendor";

announceSkip("CreateX parity", ANVIL_SKIP_REASON);

const CREATEX_ABI = parseAbi([
  "function deployCreate3(bytes32 salt, bytes initCode) payable returns (address)",
  "function computeCreate3Address(bytes32 salt) view returns (address)",
]);

/** PUSH1 1, PUSH1 12, PUSH1 0, CODECOPY, PUSH1 1, PUSH1 0, RETURN, then the one-byte runtime 0x2a (as C5b's test). */
const INIT_CODE: Hex = "0x6001600c60003960016000f32a";

/**
 * CreateX's `_guard` for a salt that starts with the sender, written out independently of core: flag 0x01 hashes
 * the chain id in, flag 0x00 doesn't. `computeCreate3Address(bytes32)` takes this guarded salt.
 */
function guarded(from: Address, salt: Hex, chainId: number): Hex {
  const flag = salt.slice(42, 44);
  return flag === "01"
    ? keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bytes32" }], [from, BigInt(chainId), salt]))
    : keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [from, salt]));
}

describe.skipIf(ANVIL_SKIP_REASON !== undefined)("CreateX's real runtime code on Anvil", () => {
  let node: Node;

  beforeAll(async () => {
    node = await startNode({ port: anvilPort(PORT.createx) });
    await etchVendored(node);
  }, 60_000);

  afterAll(async () => {
    await node?.stop();
  });

  test("the vendored code hashes to CREATEX_CODEHASH in full, and so does what the node holds", async () => {
    expect(CREATEX_CODEHASH).toBe("0xbd8a7ea8cfca7b4e5f5041d7d4b17bc317c5ce42cfbc42066a00cf26b43eb53f");
    expect(keccak256(vendoredCode("CreateX"))).toBe(CREATEX_CODEHASH);
    expect(keccak256(await node.rpc<Hex>("eth_getCode", [CREATEX, "latest"]))).toBe(CREATEX_CODEHASH);
    expect(keccak256(vendoredCode("Multicall3"))).toBe(MULTICALL3_CODEHASH);
  });

  const scopes: readonly Scope[] = ["every-chain", "this-chain"];
  const chainIds = [31337, 11155111] as const;

  for (const chainId of chainIds) {
    for (const scope of scopes) {
      test(`createxPredict equals deployCreate3 and computeCreate3Address: flag ${scope === "this-chain" ? "0x01" : "0x00"}, chain ${chainId}`, async () => {
        await withChainId(node, chainId, async () => {
          expect(Number(BigInt(await node.rpc<Hex>("eth_chainId", [])))).toBe(chainId);
          for (const from of [ALICE, BOB]) {
            const salt = buildSalt(from, scope, entropyFor(`${chainId}:${scope}:${from}`));
            const predicted = createxPredict({ from, salt, chainId });
            const computed = await node.client.readContract({ address: CREATEX, abi: CREATEX_ABI, functionName: "computeCreate3Address", args: [guarded(from, salt, chainId)] });
            expect(computed).toBe(predicted);
            const data = encodeFunctionData({ abi: CREATEX_ABI, functionName: "deployCreate3", args: [salt, INIT_CODE] });
            const preview = await node.call({ from, to: CREATEX, data });
            expect(preview.ok).toBe(true);
            expect(decodeFunctionResult({ abi: CREATEX_ABI, functionName: "deployCreate3", data: preview.data })).toBe(predicted);
            await send(node, { from, to: CREATEX, data });
            expect(await node.rpc<Hex>("eth_getCode", [predicted, "latest"])).toBe("0x2a");
          }
        });
      }, 60_000);
    }
  }

  test("flag 0x01 moves with the chain id, flag 0x00 doesn't", () => {
    const entropy = entropyFor("scope-moves");
    const here = buildSalt(ALICE, "this-chain", entropy);
    const everywhere = buildSalt(ALICE, "every-chain", entropy);
    expect(createxPredict({ from: ALICE, salt: here, chainId: 31337 })).not.toBe(createxPredict({ from: ALICE, salt: here, chainId: 11155111 }));
    expect(createxPredict({ from: ALICE, salt: everywhere, chainId: 31337 })).toBe(createxPredict({ from: ALICE, salt: everywhere, chainId: 11155111 }));
  });

  test("NET-01 passes on CreateX's real code and blocks on Lattice's MockCreateX", async () => {
    const { catalog } = builtCatalog();
    const f = fixture(catalog, "ERC20", "createx", entropyFor("net-01"));
    const salt = buildSalt(ALICE, "this-chain", f.project.deploy.entropy);
    const deploy = { chainId: 31337, path: "createx" as const, from: ALICE, salt };
    const net01 = (chain: ChainState) =>
      analyze(f.recipe, catalog, { known: [], unconfirmed: [], deploy, chain }).problems.filter((p) => p.code === "NET-01");
    expect(net01(await chainState(node, catalog))).toEqual([]);
    const snapshot = await node.client.snapshot();
    await node.client.setCode({ address: CREATEX, bytecode: mockFixture.mockCreatexRuntimeCode as Hex });
    const mocked = net01(await chainState(node, catalog));
    expect(mocked.map((p) => p.severity)).toEqual(["blocker"]);
    expect(mocked[0]?.message).toContain("isn't CreateX");
    await node.client.revert({ id: snapshot });
  });
});
