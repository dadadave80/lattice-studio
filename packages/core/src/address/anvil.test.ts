// Live checks against a local Anvil node: every prediction here is compared with what the EVM actually does.
// Skipped when `anvil` isn't on PATH (Q5 covers the same ground in e2e-chain). Never touches a real network.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { concat, encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbi, slice } from "viem";
import type { Address, Hex } from "../model/hex";
import fixture from "./fixtures/lattice-6c8db45.json";
import {
  ARACHNID_PROXY, ARACHNID_PROXY_CODEHASH, arachnidAddress, buildSalt, CREATEX, createxPredict,
  FACTORY_PREDICT_SELECTOR, factoryPredict, sharedSalt,
} from "./index";

const ALICE: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // Anvil account 0
const BOB: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // Anvil account 1
const ENTROPY: Hex = "0xc5b0c5b0c5b0c5b0c5b0c5";
/** PUSH1 1, PUSH1 12, PUSH1 0, CODECOPY, PUSH1 1, PUSH1 0, RETURN, then the one-byte runtime 0x2a. */
const INIT_CODE: Hex = "0x6001600c60003960016000f32a";

const ANVIL = Bun.which("anvil");
const CREATEX_ABI = parseAbi(["function deployCreate3(bytes32 salt, bytes initCode) payable returns (address)"]);
const FACTORY_ABI = parseAbi(["function predict(address deployer, bytes32 salt) view returns (address)"]);

let node: ReturnType<typeof Bun.spawn> | undefined;
let url = "";

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

async function send(tx: { from: Address; to?: Address; data: Hex }): Promise<{ contractAddress: Address | null; status: Hex }> {
  const hash = await rpc<Hex>("eth_sendTransaction", [tx]);
  type Receipt = { contractAddress: Address | null; status: Hex };
  // Anvil mines on arrival, but the receipt can take a moment to be indexed.
  for (let attempt = 0; attempt < 100; attempt++) {
    const receipt = await rpc<Receipt | null>("eth_getTransactionReceipt", [hash]);
    if (receipt !== null) {
      expect(receipt.status).toBe("0x1");
      return receipt;
    }
    await Bun.sleep(20);
  }
  throw new Error(`no receipt for ${hash}`);
}

const call = (from: Address, to: Address, data: Hex): Promise<Hex> => rpc<Hex>("eth_call", [{ from, to, data }, "latest"]);
const code = (address: Address): Promise<Hex> => rpc<Hex>("eth_getCode", [address, "latest"]);
const word = (data: Hex): Address => getAddress(slice(data, 12, 32));

/** On this WP's port from `.env.local`; if that's taken (or unset), on one the OS picks. */
async function startAnvil(binary: string): Promise<void> {
  const own = process.env["ANVIL_PORT_BASE"];
  if (own) {
    try {
      await spawnAnvil(binary, own);
      return;
    } catch {
      // spawnAnvil already stopped that node; try a port the OS picks.
    }
  }
  await spawnAnvil(binary, "0");
}

const START_TIMEOUT_MS = 10_000;

/** Starts Anvil and waits for its "Listening on" line, never longer than START_TIMEOUT_MS in total. */
async function spawnAnvil(binary: string, port: string): Promise<void> {
  const child = Bun.spawn([binary, "--port", port, "--chain-id", "31337"], { stdout: "pipe", stderr: "ignore" });
  node = child;
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), START_TIMEOUT_MS);
  });
  let seen = "";
  try {
    for (;;) {
      // A hung node that prints nothing can't block past the deadline: every read races the same timer.
      const next = await Promise.race([reader.read(), timeout]);
      if (next === "timeout") throw new Error(`anvil printed no "Listening on" line within ${START_TIMEOUT_MS} ms: ${seen.slice(-400)}`);
      if (next.done) throw new Error(`anvil exited before listening: ${seen.slice(-400)}`);
      seen += decoder.decode(next.value);
      const match = /Listening on ([\d.]+):(\d+)/.exec(seen);
      if (match) {
        url = `http://${match[1]}:${match[2]}`;
        void drain(reader);
        return;
      }
    }
  } catch (error) {
    child.kill();
    await child.exited;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Keeps reading Anvil's stdout until it closes, so its logging can never fill the pipe and stall the node. */
async function drain(reader: { read(): Promise<{ done: boolean }> }): Promise<void> {
  try {
    while (!(await reader.read()).done);
  } catch {
    // The node was killed; nothing left to read.
  }
}

describe.skipIf(ANVIL === null)("on Anvil", () => {
  beforeAll(async () => {
    if (ANVIL !== null) await startAnvil(ANVIL);
  }, 2 * START_TIMEOUT_MS + 5_000);

  afterAll(async () => {
    node?.kill();
    await node?.exited;
  });

  test("Arachnid's proxy is where it should be, with the codehash S8a probes for", async () => {
    expect(keccak256(await code(ARACHNID_PROXY))).toBe(ARACHNID_PROXY_CODEHASH);
  });

  test("arachnidAddress is where Arachnid's proxy deploys", async () => {
    const salt = sharedSalt("ERC20", "0.4.0");
    const predicted = arachnidAddress(salt, keccak256(INIT_CODE));
    // The proxy returns the created address as 20 raw bytes.
    expect(getAddress(await call(ALICE, ARACHNID_PROXY, concat([salt, INIT_CODE])))).toBe(predicted);
    await send({ from: BOB, to: ARACHNID_PROXY, data: concat([salt, INIT_CODE]) });
    expect(await code(predicted)).toBe("0x2a");
    expect(predicted).toBe("0xfae5C553f52bB00C2f965bdD299d159A5b78f11d"); // pinned in index.test.ts
  });

  test("factoryPredict equals LatticeFactory.predict(address,bytes32) at the pin", async () => {
    expect(keccak256(fixture.latticeCreationCode as Hex)).toBe(fixture.latticeInitCodeHash as Hex);
    // constructor(ILatticeRegistry registry, address reverseRegistrar, address reverseRecordOwner): only a
    // nonzero registry is required (LatticeFactory.sol L44-L56); predict never reads it.
    const args = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }],
      ["0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000"],
    );
    const { contractAddress } = await send({ from: ALICE, data: concat([fixture.latticeFactoryCreationCode as Hex, args]) });
    if (contractAddress === null) throw new Error("the factory wasn't created");
    const factory = getAddress(contractAddress);
    expect(factory).toBe("0x5FbDB2315678afecb367f032d93F642f64180aa3"); // Alice's first transaction
    for (const from of [ALICE, BOB]) {
      for (const scope of ["every-chain", "this-chain"] as const) {
        const salt = buildSalt(from, scope, ENTROPY);
        const data = encodeFunctionData({ abi: FACTORY_ABI, functionName: "predict", args: [from, salt] });
        expect(slice(data, 0, 4)).toBe(FACTORY_PREDICT_SELECTOR);
        const live = word(await call(ALICE, factory, data));
        expect(factoryPredict({ factory, proxyInitCodeHash: fixture.latticeInitCodeHash as Hex, from, salt })).toBe(live);
        if (from === ALICE && scope === "every-chain") expect(live).toBe("0x7E6EDbe7eC66DC17D0aebd572FaF9e3F75510631"); // pinned in index.test.ts
      }
    }
  });

  describe("CreateX (Lattice's faithful mock, etched at the canonical address)", () => {
    const deployCreate3 = (salt: Hex): Hex =>
      encodeFunctionData({ abi: CREATEX_ABI, functionName: "deployCreate3", args: [salt, INIT_CODE] });
    const liveCreate3 = async (from: Address, salt: Hex): Promise<Address> => word(await call(from, CREATEX, deployCreate3(salt)));

    beforeAll(async () => {
      await rpc("anvil_setCode", [CREATEX, fixture.mockCreatexRuntimeCode]);
      await rpc("anvil_setChainId", [31337]);
    });

    afterAll(async () => {
      await rpc("anvil_setChainId", [31337]);
    });

    test("createxPredict equals deployCreate3 for both scopes and a foreign salt", async () => {
      for (const scope of ["every-chain", "this-chain"] as const) {
        const salt = buildSalt(ALICE, scope, ENTROPY);
        const live = await liveCreate3(ALICE, salt);
        expect(createxPredict({ from: ALICE, salt, chainId: 31337 })).toBe(live);
        // Pinned in index.test.ts.
        expect(live).toBe(scope === "every-chain" ? "0xCC01deC73922ed62B57f9f0d73fC4F733578Fe77" : "0x45A0595f1a42CD051B20905dF00Dc227031fD786");
      }
      const foreign = buildSalt(BOB, "this-chain", ENTROPY);
      expect(createxPredict({ from: ALICE, salt: foreign, chainId: 31337 })).toBe(await liveCreate3(ALICE, foreign));
    });

    test("a real deploy lands at the prediction", async () => {
      const salt = buildSalt(BOB, "this-chain", ENTROPY);
      const predicted = createxPredict({ from: BOB, salt, chainId: 31337 });
      await send({ from: BOB, to: CREATEX, data: deployCreate3(salt) });
      expect(await code(predicted)).toBe("0x2a");
    });

    test("this chain only moves with the chain id; every chain doesn't", async () => {
      const here = buildSalt(ALICE, "this-chain", "0x00000000000000000000aa");
      const everywhere = buildSalt(ALICE, "every-chain", "0x00000000000000000000aa");
      const onA = { here: await liveCreate3(ALICE, here), everywhere: await liveCreate3(ALICE, everywhere) };
      await rpc("anvil_setChainId", [11155111]);
      const onB = { here: await liveCreate3(ALICE, here), everywhere: await liveCreate3(ALICE, everywhere) };
      expect(onA.here).not.toBe(onB.here);
      expect(onA.everywhere).toBe(onB.everywhere);
      expect(onA.here).toBe(createxPredict({ from: ALICE, salt: here, chainId: 31337 }));
      expect(onB.here).toBe(createxPredict({ from: ALICE, salt: here, chainId: 11155111 }));
      expect(onB.everywhere).toBe(createxPredict({ from: ALICE, salt: everywhere, chainId: 11155111 }));
    });
  });
});
