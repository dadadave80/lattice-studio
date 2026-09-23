/**
 * Chain releases from Lattice's per-chain manifests (`DeployRelease._writeManifest`, `script/deploy/
 * DeployRelease.s.sol#L286-L315` at the pin), against synthetic manifests: none exist at the pin.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address } from "@lattice-studio/core";
import { studioEnv } from "../../src/anvil";
import { type ExpectedRelease, MISSING_FACTORY_FIELDS, parseReleaseManifest, readChainReleases } from "../../src/chains";

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const a = (n: string) => `0x${n.repeat(40).slice(0, 40)}` as Address;
const FACTORY = a("fa");
const REGISTRY = a("ee");
const ERC20 = a("20");
const EXPECTED: ExpectedRelease = { version: "0.2.0", factory: FACTORY, registry: REGISTRY, facets: { ERC20, Receive: a("0e") } };
const B32 = `0x${"ab".repeat(32)}`;

/** A manifest as `vm.writeJson` writes it: facets as a nested object keyed by name. */
function manifest(chainid: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "0.2.0",
    chainid,
    createx: a("ba"),
    registry: REGISTRY,
    factory: FACTORY,
    owner: a("de"),
    timestamp: 1_789_000_000,
    facets: {
      ERC20: { name: "ERC20", address: ERC20, codehash: B32, selectorsHash: B32, salt: B32 },
      Receive: { name: "Receive", address: a("0e"), codehash: B32, selectorsHash: B32, salt: B32 },
    },
    ...over,
  };
}

function checkout(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "cg8-chains-"));
  temps.push(dir);
  for (const [path, json] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), typeof json === "string" ? json : JSON.stringify(json));
  }
  return dir;
}

describe("release manifests", () => {
  test("a manifest parses, with facets nested or as a JSON string", () => {
    const nested = parseReleaseManifest(manifest(11155111), "m.json");
    expect(nested.ok && Object.keys(nested.value.facets)).toEqual(["ERC20", "Receive"]);
    const m = manifest(11155111);
    const asString = parseReleaseManifest({ ...m, facets: JSON.stringify(m["facets"]) }, "m.json");
    expect(asString.ok && asString.value.facets["ERC20"]?.address).toBe(ERC20);
  });

  test("a malformed manifest names the file and the field", () => {
    const res = parseReleaseManifest({ ...manifest(1), factory: "0x1234" }, "deployments/1/release-0.2.0.json");
    expect(res.ok ? "" : res.error).toContain("deployments/1/release-0.2.0.json: factory is not an address.");
  });

  test("no deployments folder: no chains and no gaps (the pin)", async () => {
    expect(await readChainReleases(checkout({}), EXPECTED)).toEqual({ ok: true, value: { chains: [], gaps: [] } });
  });

  test("the pinned checkout has no release manifests", async () => {
    const dir = studioEnv("LATTICE_DIR");
    if (dir === undefined || !existsSync(join(dir, "src", "LatticeVersion.sol"))) return;
    expect(existsSync(join(dir, "deployments"))).toBe(false);
    expect(await readChainReleases(dir, EXPECTED)).toEqual({ ok: true, value: { chains: [], gaps: [] } });
  });

  test("the canonical factory: the chain is recorded by id alone, sorted, with no gaps", async () => {
    const dir = checkout({
      "deployments/84532/release-0.2.0.json": manifest(84532),
      "deployments/11155111/release-0.2.0.json": manifest(11155111),
      "deployments/1/release-0.1.0.json": manifest(1, { version: "0.1.0" }),
    });
    expect(await readChainReleases(dir, EXPECTED)).toEqual({ ok: true, value: { chains: [{ chainId: 84532 }, { chainId: 11155111 }], gaps: [] } });
  });

  test("another factory: no factory entry, and the gap names what A4 must add", async () => {
    const dir = checkout({ "deployments/11155111/release-0.2.0.json": manifest(11155111, { factory: a("c0") }) });
    const res = await readChainReleases(dir, EXPECTED);
    if (!res.ok) throw new Error(res.error);
    expect(res.value.chains).toEqual([{ chainId: 11155111 }]);
    expect(res.value.chains[0]?.factory).toBeUndefined();
    expect(res.value.gaps).toHaveLength(1);
    expect(res.value.gaps[0]).toContain("Chain 11155111: its LatticeFactory");
    expect(res.value.gaps[0]).toContain(MISSING_FACTORY_FIELDS.join(", "));
    expect(res.value.gaps[0]).toContain("(Lattice A4)");
  });

  test("a release built another way (other registry, facets elsewhere) is listed as a gap", async () => {
    const m = manifest(84532, { registry: a("11") });
    const facets = m["facets"] as Record<string, Record<string, string>>;
    facets["ERC20"] = { ...facets["ERC20"], address: a("99") };
    const res = await readChainReleases(checkout({ "deployments/84532/release-0.2.0.json": m }), EXPECTED);
    if (!res.ok) throw new Error(res.error);
    expect(res.value.gaps).toEqual([
      `Chain 84532: its LatticeRegistry ${a("11")} isn't the catalog's ${REGISTRY}.`,
      "Chain 84532: 1 of 2 facets in deployments/84532/release-0.2.0.json aren't at the catalog's addresses (ERC20).",
    ]);
  });

  test("a manifest under the wrong chain, a folder that isn't a chain id, or bad JSON is an error", async () => {
    const wrong = await readChainReleases(checkout({ "deployments/1/release-0.2.0.json": manifest(10) }), EXPECTED);
    expect(wrong.ok ? "" : wrong.error).toContain("sits under chain 1 but says chain 10");
    const named = await readChainReleases(checkout({ "deployments/sepolia/release-0.2.0.json": manifest(11155111) }), EXPECTED);
    expect(named.ok ? "" : named.error).toContain("sepolia isn't a chain id");
    const junk = await readChainReleases(checkout({ "deployments/1/release-0.2.0.json": "{not json" }), EXPECTED);
    expect(junk.ok ? "" : junk.error).toContain("isn't JSON");
  });
});
