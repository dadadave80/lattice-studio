import { describe, expect, test } from "bun:test";
import { buildSalt, factoryPredict } from "../../address";
import type { Refs } from "../../model/chain";
import type { Address } from "../../model/hex";
import type { InitPlan } from "../../model/init";
import type { Recipe } from "../../model/recipe";
import { hex, loadFixtureCatalog, makeRecipe } from "../../testing";
import { collectRefs, decodeInit, encodeInit, resolveRefs } from "./index";

describe("collectRefs", () => {
  test("none and ref-free inits use no references", () => {
    expect(collectRefs(makeRecipe())).toEqual([]);
    expect(collectRefs(makeRecipe({ init: { kind: "steps", steps: [{ spec: "ERC20Init", args: { name_: "A", symbol_: "B" } }] } }))).toEqual([]);
  });

  test("each reference once, in first-use order across steps, tuples and lists", () => {
    const recipe: Recipe = makeRecipe({
      init: {
        kind: "steps",
        steps: [
          { spec: "ERC20Init", args: { name_: "A", symbol_: "B" } },
          { spec: "AccessControlInit", args: { admin: { $ref: "deployer" } } },
          { spec: "RolesInit", args: { holders: [{ $ref: "self" }, { $ref: "deployer" }], p: { owner: { $ref: "self" } } } },
        ],
      },
    });
    expect(collectRefs(recipe)).toEqual(["deployer", "self"]);
  });

  test("a bundle's nested struct counts", () => {
    const recipe = makeRecipe({ init: { kind: "bundle", spec: "GovernedVaultInit", args: { p: { asset: { $ref: "self" }, name: "V" } } } });
    expect(collectRefs(recipe)).toEqual(["self"]);
  });
});

describe("resolveRefs", () => {
  const SELF: Address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const ME: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  test("replaces references everywhere, checksummed, and leaves everything else as it is", () => {
    const args = { admin: { $ref: "deployer" as const }, list: [{ $ref: "self" as const }, "7"], p: { owner: { $ref: "self" as const }, on: true } };
    expect(resolveRefs(args, { self: SELF.toLowerCase() as Address, deployer: ME.toLowerCase() as Address })).toEqual({
      ok: true, value: { admin: ME, list: [SELF, "7"], p: { owner: SELF, on: true } },
    });
    expect(args.admin).toEqual({ $ref: "deployer" });
  });

  test("an unused reference may be unknown; a used one may not", () => {
    expect(resolveRefs({ admin: { $ref: "deployer" } }, { deployer: ME })).toEqual({ ok: true, value: { admin: ME } });
    expect(resolveRefs({ p: { owner: { $ref: "self" } } }, { deployer: ME })).toEqual({
      ok: false, error: "p.owner is this diamond, whose address isn't known yet. Choose a chain and account first.",
    });
    expect(resolveRefs({ list: [{ $ref: "deployer" }] }, {})).toEqual({
      ok: false, error: "list[0] is the deploying account, whose address isn't known yet. Choose an account first.",
    });
  });

  test("unknown reference names and bad addresses are errors", () => {
    expect(resolveRefs({ a: { $ref: "owner" } as never }, {})).toEqual({
      ok: false, error: 'a refers to "owner", which isn\'t a reference Studio knows. Choose this diamond or the deploying account.',
    });
    expect(resolveRefs({}, { self: "0x1234" })).toEqual({ ok: false, error: "This diamond resolves to 0x1234, which isn't an address. Choose a chain and account first." });
  });
});

const fixture = loadFixtureCatalog();

describe.skipIf(!fixture.ok)("references resolve per deploy", () => {
  test("two deployers and two salts give four different encodings, none symbolic", () => {
    if (!fixture.ok) return;
    const catalog = fixture.value;
    const spec = (name: string) => catalog.inits.find((s) => s.name === name);
    const access = spec("AccessControlInit");
    const safeCut = spec("SafeDiamondCutInit");
    const intro = spec("DiamondIntrospectionInit.initUpgradeable");
    if (!access || !safeCut || !intro) throw new Error("fixture inits missing");
    const view = (s: typeof access, path: string, index: number, args: InitPlan["steps"][number]["args"]) => ({
      path, index, spec: s.name, contract: s.contract, fn: s.fn, locked: false, args, fields: [], missing: [], examples: [],
    });
    const plan: InitPlan = {
      kind: "steps",
      steps: [
        view(access, "steps[0]", 0, { admin: { $ref: "deployer" } }),
        view(safeCut, "steps[1]", 1, { admin: { $ref: "self" }, safe: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F", minThreshold: "2" }),
        { ...view(intro, "auto", 2, {}), automatic: "initUpgradeable" as const, locked: true },
      ],
    };
    const deployers: Address[] = ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"];
    const entropies = [hex(1, 11), hex(2, 11)];
    const seen = new Map<string, Refs>();
    for (const deployer of deployers) {
      for (const entropy of entropies) {
        const salt = buildSalt(deployer, "every-chain", entropy);
        const self = factoryPredict({ factory: catalog.factory.address, proxyInitCodeHash: catalog.proxy.initCodeHash, from: deployer, salt });
        const refs = { self, deployer };
        const encoded = encodeInit(plan, catalog, refs);
        if (!encoded.ok) throw new Error(encoded.error);
        const decoded = decodeInit(encoded.value.data, catalog, refs);
        expect(JSON.stringify(decoded)).not.toContain("$ref");
        expect(decoded.ok && decoded.value.steps.slice(0, 2).map((s) => [s.args.admin, s.fromRef])).toEqual([
          [deployer, { admin: "deployer" }],
          [self, { admin: "self" }],
        ]);
        seen.set(encoded.value.data, refs);
      }
    }
    expect(seen.size).toBe(4);
    expect(new Set([...seen.values()].map((r) => r.self)).size).toBe(4);
  });
});
