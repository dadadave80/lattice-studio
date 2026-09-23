/**
 * The deploy machine against a local Anvil (Foundry 1.8.3) on this worktree's `ANVIL_PORT_BASE`: the real
 * catalog (CG8), CreateX and Multicall3 etched from Q5's hash-checked vendor files (not Lattice's MockCreateX), the
 * shared contracts deployed by the machine's own missing-contracts step through Arachnid's proxy, then a v1 recipe
 * deployed by both paths, a mismatch from a pre-used salt, the stale timeout on a manual clock, resume from a record,
 * and a From file record confirmed by re-reading. Skipped when Anvil or the port isn't available. The node is spawned
 * as S8a's probe test does: prool's barrel pulls in http-proxy, whose follow-redirects throws under `bun test`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Address, Catalog, Deployment, Hex, LoupeFacet, Project, Result } from "@lattice-studio/core";
import { CREATEX, CREATEX_CODEHASH, MULTICALL3, MULTICALL3_CODEHASH, planInit, toChecksum } from "@lattice-studio/core";
import { filledTemplate, loadBuiltCatalog, makeProject } from "@lattice-studio/core/testing";
import { createClient, defineChain, http, keccak256, parseAbi, type Chain, type Client, type Transport } from "viem";
import { getCode, getTransactionCount, readContract, sendTransaction } from "viem/actions";
import { localEnv } from "../../../local-env";
import type { ChainService } from "@/contracts";
import { probeChain } from "../infra/probe";
import { releaseOf } from "./judge";
import { createDeployMachine, type DeployMachine } from "./machine";
import type { DeployDeps } from "./ports";
import { ALICE, BOB, fakeInputs, fakeRecords, manualClock, type FakeInputs, type FakeRecords, type ManualClock } from "./testing";
import { createViemPort, isRejection, reason } from "./viem-port";

const port = Number(localEnv("ANVIL_PORT_BASE") ?? "");
const runnable = Number.isInteger(port) && port > 0 && Bun.which("anvil") !== null;
const ANVIL_ID = 31337;
const ROOT = new URL("../../../../../", import.meta.url);

const built = loadBuiltCatalog();
const catalog: Catalog | null = built.ok ? built.value : null;

/** The catalog's directory (`catalog/<id>/`). */
function catalogDir(): URL {
  const manifest = JSON.parse(readFileSync(new URL("catalog/manifest.json", ROOT), "utf8")) as { default: string; catalogs: { id: string; path: string }[] };
  const entry = manifest.catalogs.find((c) => c.id === manifest.default);
  if (!entry) throw new Error("no default catalog");
  return new URL(entry.path, new URL("catalog/", ROOT));
}

function creationCode(c: Catalog, name: string): Result<Hex, string> {
  const path = name === "Lattice" ? c.proxy.creationCode.path : releaseOf(c, name)?.creationCode.path;
  if (!path) return { ok: false, error: `${name} has no creation code in this catalog.` };
  return { ok: true, value: readFileSync(new URL(path, catalogDir()), "utf8").trim().toLowerCase() as Hex };
}

/** Q5's vendored runtime code, refused unless it hashes to core's pinned codehash. */
function vendored(file: string, codehash: Hex): Hex {
  const code = readFileSync(new URL(`e2e-chain/vendor/${file}`, ROOT), "utf8").trim() as Hex;
  if (keccak256(code) !== codehash) throw new Error(`${file} doesn't hash to ${codehash}`);
  return code;
}

const LOUPE = parseAbi(["function facets() view returns ((address facetAddress, bytes4[] functionSelectors)[])"]);

let node: ReturnType<typeof Bun.spawn> | null = null;
let client: Client<Transport, Chain>;
let url = "";

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

/** A chain service over the node: S8a's probe program, code and loupe reads, and Anvil's account 0. */
function anvilService(predicted: () => Address | null): Pick<ChainService, "chains" | "probe" | "codeAt" | "readFacets" | "account"> {
  return {
    chains: () => [{ id: ANVIL_ID, name: "Anvil", testnet: true }],
    account: () => ({ address: ALICE, chainId: ANVIL_ID, connector: "anvil" }),
    async probe(chainId, options) {
      if (!catalog) return { ok: false, error: "no catalog" };
      const target = predicted();
      const state = await probeChain(client, {
        chainId, name: "Anvil", catalog, online: true, probedAt: () => "2026-09-23T12:00:00.000Z",
        codeAt: [...(options?.codeAt ?? []), ...(target ? [target] : [])],
      });
      const code = target ? state.codeAt[target.toLowerCase()] : undefined;
      return { ok: true, value: { ...state, ...(code === undefined ? {} : { predictedHasCode: code !== "0x" }) } };
    },
    async codeAt(_chainId, address) {
      const code = await getCode(client, { address });
      return { ok: true, value: code === undefined || code === "0x" ? "0x" : code };
    },
    async readFacets(_chainId, address) {
      try {
        const facets = await readContract(client, { address, abi: LOUPE, functionName: "facets" });
        return { ok: true, value: facets.map((f): LoupeFacet => ({ facetAddress: toChecksum(f.facetAddress), functionSelectors: f.functionSelectors.map((s) => s.toLowerCase() as Hex) })) };
      } catch {
        return { ok: false, error: `There's no diamond at ${toChecksum(address)} on Anvil.` };
      }
    },
  };
}

type Rig = { m: DeployMachine; inputs: FakeInputs; records: FakeRecords; said: string[]; clock: ManualClock | null };

function rig(project: Project, options: { records?: FakeRecords; clock?: ManualClock } = {}): Rig {
  if (!catalog) throw new Error("no catalog");
  const said: string[] = [];
  const records = options.records ?? fakeRecords();
  const inputs = fakeInputs({ catalog, project, chainId: ANVIL_ID, account: () => ({ address: ALICE, chainId: ANVIL_ID }) });
  inputs.setAck(inputs.analysis().problems.filter((p) => p.ack === true).map((p) => p.id));
  const predicted = () => {
    const p = inputs.prediction();
    return p.status === "ready" ? p.address : null;
  };
  const chainPort = createViemPort({
    service: anvilService(predicted),
    client: () => client,
    noteEstimate: () => {},
    pollInterval: 25,
    wallet: {
      async send(_chainId, { from, tx, gas }) {
        try {
          return {
            kind: "sent",
            value: await sendTransaction(client, { account: from, to: tx.to, data: tx.data, value: tx.value, chain: null, ...(gas === undefined ? {} : { gas }) }),
          };
        } catch (error) {
          return isRejection(error) ? { kind: "rejected" } : { kind: "error", message: reason(error) };
        }
      },
      atomicBatch: async () => false,
      sendCalls: async () => ({ kind: "error", message: "No EIP-5792 wallet on Anvil." }),
      waitCalls: async () => ({ kind: "error", message: "No EIP-5792 wallet on Anvil." }),
    },
  });
  const deps: DeployDeps = {
    inputs,
    chain: async () => chainPort,
    records,
    files: {
      detail: async (name) => ({ ok: false, error: `${name} has no ABI shard here.` }),
      code: async (name) => creationCode(catalog, name),
    },
    say: { log: (line) => void said.push(line.text), announce: () => {}, showBanner: () => {}, hideBanner: () => {} },
    settings: () => ({ receiptTimeout: 180, deployAnnouncements: "none" }),
    clock: options.clock ?? {
      now: () => Date.now(),
      setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
    },
  };
  return { m: createDeployMachine(deps), inputs, records, said, clock: options.clock ?? null };
}

function project(entropy: Hex, path: "factory" | "createx" = "factory", edit?: (p: Project) => Project): Project {
  if (!catalog) throw new Error("no catalog");
  const recipe = filledTemplate(catalog, "ERC20");
  if (!recipe.ok) throw new Error(recipe.error);
  const base = makeProject({
    id: "anvil-project", name: "Token", recipe: recipe.value,
    deploy: { path, entropy, scope: path === "factory" ? "every-chain" : "this-chain" },
  });
  return edit ? edit(base) : base;
}

async function until(check: () => boolean, what: string, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
}

async function deploy(r: Rig): Promise<Deployment> {
  r.m.open();
  await until(() => r.m.state().phase === "ready" || r.m.state().error !== undefined || r.m.state().simulation?.ok === false, "the simulation");
  expect(r.m.state().error).toBeUndefined();
  expect(r.m.state().phase).toBe("ready");
  await r.m.sign();
  await until(() => ["verifying", "mismatch", "failed"].includes(r.m.state().phase), "the deploy to settle");
  const address = r.m.state().address;
  const found = address ? r.records.get(ANVIL_ID, address) : undefined;
  if (!found) throw new Error("no record");
  return found;
}

describe.skipIf(!runnable || catalog === null)("the deploy machine on Anvil", () => {
  beforeAll(async () => {
    node = Bun.spawn([Bun.which("anvil") ?? "anvil", "--port", String(port), "--host", "127.0.0.1", "--chain-id", String(ANVIL_ID), "--silent"], {
      stdout: "ignore", stderr: "ignore",
    });
    url = `http://127.0.0.1:${port}`;
    for (let i = 0; ; i++) {
      try {
        await rpc("eth_chainId");
        break;
      } catch (error) {
        if (i > 200) throw error;
        await Bun.sleep(50);
      }
    }
    client = createClient({
      chain: defineChain({ id: ANVIL_ID, name: "Anvil", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url] } } }),
      transport: http(url),
      pollingInterval: 25,
    });
    await rpc("anvil_setCode", [CREATEX, vendored("CreateX.runtime.hex", CREATEX_CODEHASH)]);
    await rpc("anvil_setCode", [MULTICALL3, vendored("Multicall3.runtime.hex", MULTICALL3_CODEHASH)]);
  }, 60_000);

  afterAll(async () => {
    node?.kill();
    await node?.exited;
  });

  test("missing contracts deploy through Arachnid's proxy, batched through Multicall3, each Deployed", async () => {
    if (!catalog) return;
    const r = rig(project("0x0000000000000000000001"));
    const analysis = r.inputs.analysis();
    const names = new Set<string>(["LatticeRegistry", "LatticeFactory", ...analysis.plan.map((e) => e.facet)]);
    for (const step of planInit(r.inputs.project().recipe, catalog).steps) names.add(step.spec);
    if (planInit(r.inputs.project().recipe, catalog).steps.length > 1) names.add("MultiInit");
    await r.m.prepareMissing(ANVIL_ID, [...names]);
    expect(r.m.missingStep().items.every((item) => item.status === "missing")).toBe(true);
    await r.m.deployMissing([...names]);
    const step = r.m.missingStep();
    expect(step.error).toBeUndefined();
    expect(step.mode).toBe("multicall");
    expect(step.items.every((item) => item.status === "deployed")).toBe(true);
    for (const name of names) {
      const release = releaseOf(catalog, name);
      if (!release) throw new Error(name);
      expect(keccak256((await getCode(client, { address: release.address })) ?? "0x")).toBe(release.codehash.toLowerCase() as Hex);
    }
    expect(r.said.at(-1)).toBe(`Deployed ${names.size} missing contracts on Anvil.`);
    // Repeating is safe: the chain is read again and nothing is sent.
    await r.m.deployMissing([...names]);
    expect(r.said.at(-1)).toBe("Nothing to deploy: every contract is already on this chain.");
  }, 120_000);

  test("a v1 recipe deploys through LatticeFactory: simulated, signed, confirmed against facets()", async () => {
    const r = rig(project("0x0000000000000000000002"));
    const record = await deploy(r);
    expect(r.m.state().phase).toBe("verifying");
    expect(record).toMatchObject({ status: "confirmed", path: "factory", deployer: ALICE, verification: "pending" });
    expect(r.said.some((t) => /^Simulated at block [\d,]+: succeeded, \d+ events?\.$/.test(t))).toBe(true);
    expect(r.said.some((t) => t.endsWith("Matches the sheet."))).toBe(true);
  }, 60_000);

  test("the same recipe deploys through CreateX CREATE3", async () => {
    const r = rig(project("0x0000000000000000000003", "createx"));
    const record = await deploy(r);
    expect(record).toMatchObject({ status: "confirmed", path: "createx" });
    expect(r.m.state().phase).toBe("verifying");
  }, 60_000);

  test("a pre-used (sender, salt) at LatticeFactory returns the older diamond: Mismatch, never Live", async () => {
    const entropy: Hex = "0x0000000000000000000004";
    const first = rig(project(entropy));
    // Same account and salt, one selector fewer.
    const second = rig(project(entropy, "factory", (p) => {
      const facet = first.inputs.analysis().plan.find((e) => e.facet === "ERC20");
      const selector = facet?.selectors.at(-1);
      if (!selector) throw new Error("no ERC20 selector");
      return { ...p, recipe: { ...p.recipe, exclude: [...p.recipe.exclude, selector] } };
    }));
    expect(second.inputs.analysis().problems.filter((p) => p.severity === "blocker")).toEqual([]);
    await rpc("evm_setAutomine", [false]);
    try {
      // Both are sent before either lands: the older one creates the diamond, and the factory hands the same diamond
      // back to the newer one without an event.
      for (const r of [first, second]) {
        r.m.open();
        await until(() => r.m.state().phase === "ready", "the simulation");
        await r.m.sign();
        await until(() => r.m.state().phase === "pending", "the submission");
      }
      await rpc("evm_mine");
      await until(() => second.m.state().phase === "mismatch" && first.m.state().phase === "verifying", "both to settle");
    } finally {
      await rpc("evm_setAutomine", [true]);
    }
    const address = second.m.state().address;
    if (!address) throw new Error("no address");
    expect(first.m.state().address).toBe(address);
    expect(second.records.get(ANVIL_ID, address)?.status).toBe("mismatch");
    expect(second.m.state().error).toBe("Deployed, but `facets()` doesn't match the plan.");
    expect(second.said.some((t) => t.endsWith("doesn't match the sheet: 1 selector differ."))).toBe(true);
  }, 60_000);

  test("stale after the receipt timeout (manual clock), then the late receipt is recorded; a reload resumes from the record", async () => {
    const clock = manualClock(Date.now());
    const records = fakeRecords();
    const r = rig(project("0x0000000000000000000005"), { clock, records });
    await rpc("evm_setAutomine", [false]);
    try {
      r.m.open();
      await until(() => r.m.state().phase === "ready", "the simulation");
      await r.m.sign();
      await until(() => r.m.state().phase === "pending", "the submission");
      clock.advance(180_000);
      expect(r.m.state().phase).toBe("stale");
      expect(r.m.state().error).toBe("Not seen for 3 minutes. It may have been dropped.");
      // A reload: a new machine over the same records picks the transaction up from its hash.
      const tx = r.m.state().tx;
      r.m.dispose();
      const reloaded = rig(project("0x0000000000000000000005"), { records });
      await reloaded.m.refresh();
      expect(reloaded.m.state()).toMatchObject({ phase: "pending", tx });
      await rpc("evm_mine");
      await until(() => reloaded.m.state().phase === "verifying", "the late receipt");
      const address = reloaded.m.state().address;
      expect(address ? records.get(ANVIL_ID, address)?.status : null).toBe("confirmed");
    } finally {
      await rpc("evm_setAutomine", [true]);
    }
  }, 60_000);

  test("a From file record is confirmed by re-reading facets() and codehashes, and loses its From file mark", async () => {
    const deployed = rig(project("0x0000000000000000000006"));
    const record = await deploy(deployed);
    const records = fakeRecords();
    records.seed([{ ...record, fromFile: true }]);
    const opened = rig(project("0x0000000000000000000006"), { records });
    await opened.m.refresh();
    await until(() => records.get(ANVIL_ID, record.address)?.fromFile === undefined, "the re-read");
    expect(records.get(ANVIL_ID, record.address)?.status).toBe("confirmed");
    expect(opened.said.some((t) => t.startsWith("Re-read ") && t.endsWith("it matches its record."))).toBe(true);
  }, 60_000);
  describe("the receipt watcher's replacement detection", () => {
    const TARGET: Address = "0x000000000000000000000000000000000000dEaD";

    async function watchReplaced(replace: (nonce: number) => { to: Address; data: Hex }): Promise<{ outcome: unknown; repriced: Hex[]; first: Hex }> {
      const chainPort = createViemPort({
        service: anvilService(() => null), client: () => client, noteEstimate: () => {}, pollInterval: 25,
        wallet: { send: async () => ({ kind: "error", message: "" }), atomicBatch: async () => false, sendCalls: async () => ({ kind: "rejected" }), waitCalls: async () => ({ kind: "aborted" }) },
      });
      await rpc("evm_setAutomine", [false]);
      try {
        const nonce = await getTransactionCount(client, { address: BOB, blockTag: "pending" });
        const first = await sendTransaction(client, {
          account: BOB, to: TARGET, data: "0x1234", nonce, chain: null, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
        });
        const repriced: Hex[] = [];
        const abort = new AbortController();
        const watching = chainPort.watch(ANVIL_ID, first, { from: BOB, signal: abort.signal, onRepriced: (hash) => void repriced.push(hash) });
        // Let the watcher see the pending transaction before the wallet replaces it.
        await Bun.sleep(200);
        const next = replace(nonce);
        await sendTransaction(client, {
          account: BOB, ...next, nonce, chain: null, maxFeePerGas: 20_000_000_000n, maxPriorityFeePerGas: 10_000_000_000n,
        });
        await rpc("evm_mine");
        const outcome = await Promise.race([watching, Bun.sleep(10_000).then(() => "timeout")]);
        abort.abort();
        return { outcome, repriced, first };
      } finally {
        await rpc("evm_setAutomine", [true]);
      }
    }

    test("a speed-up (the same call at a higher fee) is followed under its new hash", async () => {
      const { outcome, repriced, first } = await watchReplaced(() => ({ to: TARGET, data: "0x1234" }));
      expect(repriced).toHaveLength(1);
      expect(repriced[0]).not.toBe(first);
      expect(outcome).toMatchObject({ kind: "receipt", hash: repriced[0], status: "success" });
    }, 30_000);

    test("a cancel (to self, no value) ends the watch as canceled", async () => {
      const { outcome, repriced } = await watchReplaced(() => ({ to: BOB, data: "0x" }));
      expect(repriced).toEqual([]);
      expect(outcome).toMatchObject({ kind: "replaced", reason: "cancelled" });
    }, 30_000);
  });
});
