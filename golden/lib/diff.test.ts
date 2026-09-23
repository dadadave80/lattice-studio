import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { diffRouting, parseRoutingFile } from "./diff.ts";
import { type RoutingFile, serialize } from "./report.ts";

const EXPECTED = join(import.meta.dir, "..", "expected");

function load(name: string): RoutingFile {
  const parsed = parseRoutingFile(readFileSync(join(EXPECTED, name), "utf8"));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

const clone = (f: RoutingFile): RoutingFile => structuredClone(f);

describe("the committed expected files", () => {
  const files = readdirSync(EXPECTED).filter((f) => f.endsWith(".routing.json")).sort();

  test("cover the three v1 recipes", () => {
    expect(files).toEqual(["ERC20.routing.json", "GovernedVault.routing.json", "SafeDiamondCut.routing.json"]);
  });

  test.each(files)("%s is exactly what --update writes", (name) => {
    const text = readFileSync(join(EXPECTED, name), "utf8");
    const file = load(name);
    expect(serialize(file)).toBe(text);
    expect(Object.keys(file.routing)).toEqual(Object.keys(file.routing).sort());
    for (const s of Object.keys(file.routing)) expect(s).toMatch(/^0x[0-9a-f]{8}$/);
    expect(Object.keys(file.signatures)).toEqual(Object.keys(file.routing));
    expect(new Set(Object.values(file.routing))).toEqual(new Set(file.facets));
    expect(diffRouting(file, clone(file))).toEqual([]);
  });

  test("GovernedVault keeps the seams R19 names on the facets that keep state in step", () => {
    const { routing } = load("GovernedVault.routing.json");
    for (const s of ["0xa9059cbb", "0x23b872dd", "0x6e553f65", "0x94bf804d", "0xb460af94", "0xba087652", "0x8ff262e3"]) {
      expect(routing[s]).toBe("GovernedVault");
    }
    expect(routing["0x5c19a95c"]).toBe("ERC20Votes"); // delegate(address)
    expect(routing["0xc3cda520"]).toBe("ERC20Votes"); // delegateBySig
    expect(routing["0x01e1d114"]).toBe("VaultCore"); // totalAssets()
    expect(routing["0x313ce567"]).toBe("ERC4626"); // decimals()
  });
});

describe("diffRouting", () => {
  const base = load("ERC20.routing.json");

  test("a hand-edited owner reads as selector, signature, expected → actual", () => {
    const edited = clone(base);
    edited.routing["0xa9059cbb"] = "ERC20Votes";
    expect(diffRouting(edited, base)).toEqual(["0xa9059cbb transfer(address,uint256): ERC20Votes → ERC20"]);
  });

  test("added and removed selectors, facets and init steps are listed", () => {
    const expected = clone(base);
    delete expected.routing["0x00000000"];
    delete expected.signatures["0x00000000"];
    expected.facets = expected.facets.filter((f) => f !== "Receive");
    expected.routing["0x12345678"] = "ERC20";
    expected.signatures["0x12345678"] = "mint(address,uint256)";
    expected.init.steps.pop();
    expect(diffRouting(expected, base)).toEqual([
      "facets: [ERC165Facet, ERC20, DiamondLoupeFacet] → [ERC165Facet, ERC20, DiamondLoupeFacet, Receive]",
      "0x00000000 receive(): (not routed) → Receive",
      "0x12345678 mint(address,uint256): ERC20 → (not routed)",
      "init step 1: (no step) → DiamondIntrospectionInit.initImmutable() (0xd1a4dbd8)",
    ]);
  });

  test("an init kind change and a script change are listed", () => {
    const expected = clone(base);
    expected.init.kind = "direct";
    expected.script = "script/base/tokens/DeployToken.s.sol";
    expect(diffRouting(expected, base)).toEqual([
      "script: script/base/tokens/DeployToken.s.sol → script/base/tokens/DeployERC20.s.sol",
      "init: direct → MultiInit",
    ]);
  });

  test("an extra key still fails", () => {
    const expected = { ...clone(base), note: "hand-written" } as RoutingFile;
    expect(diffRouting(expected, base)).toEqual([
      "the file differs from what --update writes (extra keys or a different key order)",
    ]);
  });
});

describe("parseRoutingFile", () => {
  test("reports invalid JSON and wrong shapes", () => {
    const bad = parseRoutingFile("{");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/isn't valid JSON/);
    const shape = parseRoutingFile(JSON.stringify({ recipe: "ERC20" }));
    expect(shape).toEqual({ ok: false, error: "doesn't have the routing file's shape" });
  });
});
