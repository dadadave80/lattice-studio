/**
 * Integration: the pinned Lattice checkout, built with the ci profile, and a real Anvil. Runs when forge and
 * anvil are installed and `LATTICE_DIR` (or the repo's `lattice/`) is a checkout; skipped otherwise. The build
 * is incremental: seconds when `out/` is current, minutes from clean.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type AnvilHandle,
  ARACHNID_DEPLOYER,
  arachnidTarget,
  deployViaArachnid,
  ethCall,
  getCode,
  startAnvil,
  studioEnv,
} from "../../src/anvil";
import { checkBuildOutputs, libraryPlaceholder, RECEIVE_SELECTOR, SELF_SELECTOR } from "../../src/artifacts";
import { type FacetFacts, readFacets, readInventory } from "../../src/inventory";
import { facetNatspec, natspecSummary } from "../../src/natspec";
import { realBuildGate } from "./real-build-gate";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const gate = realBuildGate((name) => studioEnv(name, REPO_ROOT), REPO_ROOT, (bin) => Bun.which(bin));
const LATTICE = gate.latticeDir;

const BUILD_TIMEOUT_MS = 20 * 60_000;

const title = "against the pinned Lattice, built with FOUNDRY_PROFILE=ci";
describe.skipIf(!gate.run)(gate.run ? title : `${title} (skipped: ${gate.reason})`, () => {
  let anvil: AnvilHandle | undefined;
  let facts: FacetFacts[] = [];

  beforeAll(async () => {
    const build = Bun.spawn(["forge", "build", "--root", LATTICE], {
      env: { ...process.env, FOUNDRY_PROFILE: "ci" },
      stdout: "ignore",
      stderr: "pipe",
    });
    if ((await build.exited) !== 0) {
      throw new Error(`forge build failed:\n${await new Response(build.stderr).text()}`);
    }
    const started = await startAnvil();
    if (!started.ok) throw new Error(started.error);
    anvil = started.value;
    const result = await readFacets(LATTICE, anvil);
    if (!result.ok) throw new Error(result.error);
    facts = result.value;
  }, BUILD_TIMEOUT_MS);

  afterAll(async () => {
    await anvil?.stop();
  });

  test("the inventory has 100 facets, and the catalog has exactly those, in order", async () => {
    const inventory = await readInventory(LATTICE);
    if (!inventory.ok) throw new Error(inventory.error);
    expect(inventory.value).toHaveLength(100);
    expect(facts.map((f) => f.name)).toEqual(inventory.value.map((e) => e.name));
    expect(inventory.value.filter((e) => e.basename).map((e) => e.name)).toEqual([
      "DiamondCutFacet",
      "DiamondLoupeFacet",
      "ERC165Facet",
      "OwnableFacet",
    ]);
  });

  test("diamond-lib's four take their source paths from the artifacts' metadata", () => {
    const sources = Object.fromEntries(facts.map((f) => [f.name, f.source]));
    expect(sources.DiamondCutFacet).toBe("lib/diamond-lib/src/facets/DiamondCutFacet.sol");
    expect(sources.OwnableFacet).toBe("lib/diamond-lib/src/facets/OwnableFacet.sol");
    expect(sources.ERC20).toBe("src/tokens/ERC20/ERC20.sol");
    expect(facts.every((f) => f.source.endsWith(`/${f.name}.sol`))).toBe(true);
  });

  test("every facet exports selectors, none is 0x0ef22643, and each is in the ABI except Receive's 0x00000000", () => {
    for (const f of facts) {
      expect({ facet: f.name, mismatches: f.mismatches }).toEqual({ facet: f.name, mismatches: [] });
      expect(f.selectors.length).toBeGreaterThan(0);
      for (const s of f.selectors) {
        expect(s.hex).not.toBe(SELF_SELECTOR);
        if (s.hex === RECEIVE_SELECTOR) {
          expect({ facet: f.name, s }).toEqual({ facet: "Receive", s: { hex: RECEIVE_SELECTOR, signature: "receive()" } });
        } else {
          expect(f.artifact.methodIdentifiers[s.signature]).toBe(s.hex);
        }
      }
      const abiSet = Object.values(f.artifact.methodIdentifiers).filter((h) => h !== SELF_SELECTOR);
      if (f.name !== "Receive") expect(new Set(f.selectors.map((s) => s.hex))).toEqual(new Set(abiSet));
    }
    expect(facts.find((f) => f.name === "Receive")?.selectors).toEqual([{ hex: RECEIVE_SELECTOR, signature: "receive()" }]);
  });

  test("the ci profile emits storage layouts and build info", async () => {
    const erc20 = facts.find((f) => f.name === "ERC20");
    if (!erc20) throw new Error("ERC20 missing");
    expect(await checkBuildOutputs(join(LATTICE, "out"), erc20.artifact)).toEqual({
      storageLayout: true,
      buildInfo: true,
      missing: [],
    });
    expect(facts.every((f) => f.artifact.storageLayout !== undefined)).toBe(true);
  });

  test("every facet compiles with solc 0.8.36, 1,000,000 optimizer runs and no linked library left open", () => {
    for (const f of facts) {
      expect(f.artifact.metadata.compiler.version.startsWith("0.8.36+")).toBe(true);
      expect(f.artifact.metadata.settings.optimizer?.runs).toBe(1_000_000);
    }
    const linked = facts.filter((f) => Object.keys(f.artifact.bytecode.linkReferences).length > 0).map((f) => f.name);
    expect(linked).toEqual(["Semaphore", "ShieldedPool"]);
    const pool = facts.find((f) => f.name === "ShieldedPool");
    expect(pool?.artifact.bytecode.object).toContain(libraryPlaceholder("lib/poseidon-solidity/PoseidonT3.sol", "PoseidonT3"));
  });

  test("every facet has a NatSpec summary and shard notices for its selectors", () => {
    for (const f of facts) expect({ facet: f.name, summary: typeof natspecSummary(f.artifact.metadata) }).toEqual({ facet: f.name, summary: "string" });
    const erc20 = facts.find((f) => f.name === "ERC20");
    if (!erc20) throw new Error("ERC20 missing");
    const natspec = facetNatspec(erc20.artifact.metadata, erc20.selectors);
    expect(Object.keys(natspec.functions)).toHaveLength(9);
    expect(natspec.functions["0xa9059cbb"]?.notice).toBe("Transfers `value` tokens from the caller to `to`.");
  });

  test("Arachnid's proxy deploys to the predicted address, and eth_call reaches the code", async () => {
    if (!anvil) throw new Error("no anvil");
    // Runtime: return 32 bytes of 0x2a. Creation: copy it and return it.
    const runtime = "602a60005260206000f3";
    const creation = `0x600a600c600039600a6000f3${runtime}` as const;
    const salt = `0x${"11".repeat(32)}` as const;
    expect(await getCode(anvil, ARACHNID_DEPLOYER)).not.toBe("0x");
    const at = await deployViaArachnid(anvil, creation, salt);
    expect(at).toEqual({ ok: true, value: arachnidTarget(creation, salt) });
    if (!at.ok) return;
    expect(await getCode(anvil, at.value)).toBe(`0x${runtime}`);
    expect(await ethCall(anvil, at.value, "0x")).toEqual({ ok: true, value: `0x${"00".repeat(31)}2a` });
    // Deploying the same code again reuses it.
    expect(await deployViaArachnid(anvil, creation, salt)).toEqual(at);
  });

  test("a reverting creation comes back as an error", async () => {
    if (!anvil) throw new Error("no anvil");
    const result = await deployViaArachnid(anvil, "0x60006000fd");
    expect(result.ok).toBe(false);
  });
});

describe.skipIf(Bun.which("anvil") === null)("startAnvil", () => {
  // Only this WP's own Anvil port is ever bound; with it taken, the OS picks one outside every claim.ts slot.
  const own = Number(studioEnv("ANVIL_PORT_BASE", REPO_ROOT) ?? 8545);
  const SLOT_PORTS_END = 24_000;

  function block(port: number): { stop(): void } {
    try {
      const server = Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } });
      return { stop: () => server.stop(true) };
    } catch {
      return { stop: () => {} }; // already taken, which is what the test needs
    }
  }

  test("with its own port taken, it runs on an OS-assigned port and frees it on stop", async () => {
    const blocker = block(own);
    try {
      const started = await startAnvil({ portBase: own });
      if (!started.ok) throw new Error(started.error);
      expect(started.value.port).not.toBe(own);
      expect(started.value.port).toBeGreaterThanOrEqual(SLOT_PORTS_END);
      expect(await started.value.request<string>("eth_chainId")).toBe("0x7a69");
      await started.value.stop();
      await started.value.stop();
      const again = Bun.listen({ hostname: "127.0.0.1", port: started.value.port, socket: { data() {} } });
      again.stop(true);
    } finally {
      blocker.stop();
    }
  }, 30_000);

  test("without the fallback, a taken port is refused, not scanned past", async () => {
    const blocker = block(own);
    try {
      expect(await startAnvil({ portBase: own, fallback: false })).toEqual({
        ok: false,
        error: `port ${own} is taken, so anvil can't start there.`,
      });
    } finally {
      blocker.stop();
    }
  });
});
