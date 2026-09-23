/**
 * The codehash program and the probes against a real node: a local Anvil (Foundry 1.8.3) on this worktree's
 * `ANVIL_PORT_BASE`, which predeploys only Arachnid's proxy. Skipped when Anvil or the port isn't available.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Address } from "@lattice-studio/core";
import { ARACHNID_PROXY, ARACHNID_PROXY_CODEHASH } from "@lattice-studio/core";
import { keccak256 } from "viem";
import { getCode } from "viem/actions";
import { localEnv } from "../../../local-env";
import { ANVIL } from "./chains";
import { createClients, type ChainClient } from "./clients";
import { probeChain, readCodehashes } from "./probe";
import { fixtureCatalog } from "./testing";

/** This worktree's Anvil port (never a fixed one): `process.env`, then the repo's `.env.local`. */
const port = Number(localEnv("ANVIL_PORT_BASE") ?? "");
const anvil = Bun.which("anvil");
const runnable = Number.isInteger(port) && port > 0 && anvil !== null;

let node: ReturnType<typeof Bun.spawn> | null = null;
let client: ChainClient;

async function waitForNode(url: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' });
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await Bun.sleep(50);
  }
  throw new Error(`Anvil didn't start on ${url}.`);
}

describe.skipIf(!runnable)("against Anvil", () => {
  beforeAll(async () => {
    node = Bun.spawn([anvil ?? "anvil", "--port", String(port), "--silent"], { stdout: "ignore", stderr: "ignore" });
    const url = `http://127.0.0.1:${port}`;
    await waitForNode(url);
    client = createClients({ overrides: () => ({ [ANVIL.id]: url }), rank: false }).get(ANVIL);
  });

  afterAll(async () => {
    node?.kill();
    await node?.exited;
  });

  test("the program returns each address's EXTCODEHASH, matching keccak256(eth_getCode)", async () => {
    const funded = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
    const nobody = "0x000000000000000000000000000000000000dEaD" as Address;
    const hashes = await readCodehashes(client, [ARACHNID_PROXY, funded, nobody]);
    const code = await getCode(client, { address: ARACHNID_PROXY });
    expect(code).toBeDefined();
    expect(hashes).toEqual([keccak256(code ?? "0x"), null, null]);
    expect(hashes[0]).toBe(ARACHNID_PROXY_CODEHASH);
  });

  test("a fresh node: Arachnid's proxy only, nothing of Lattice's, simulate supported, the block's gas limit", async () => {
    const catalog = fixtureCatalog();
    const state = await probeChain(client, {
      chainId: ANVIL.id,
      name: ANVIL.name,
      catalog,
      codeAt: [],
      online: true,
      probedAt: () => "2026-09-23T12:00:00.000Z",
    });
    expect(state.deployer).toEqual({ present: true, codehash: ARACHNID_PROXY_CODEHASH });
    expect(state.multicall3).toEqual({ present: false });
    expect(state.createx).toEqual({ present: false });
    expect(state.shared.LatticeRegistry).toEqual({ present: false });
    expect(Object.values(state.shared).every((probe) => !probe.present)).toBe(true);
    expect(state.registry).toBeUndefined();
    expect(state.simulate).toBe(true);
    expect(BigInt(state.gasCap ?? "0")).toBeGreaterThan(0n);
  });
});
