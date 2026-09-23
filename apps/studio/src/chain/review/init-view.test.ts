import { describe, expect, test } from "bun:test";
import type { Address, Catalog, Hex, Recipe } from "@lattice-studio/core";
import { analyze, decodeInit, loadTemplate, planInit, toChecksum } from "@lattice-studio/core";
import { loadFixtureCatalog } from "@lattice-studio/core/testing";
import {
  argumentPath, ensEntries, flattenArgs, plannedValue, recheckLine, refText, valueText, type EnsEntry,
} from "./init-view";

const loaded = loadFixtureCatalog("fixture");
if (!loaded.ok) throw new Error(loaded.error);
const catalog: Catalog = loaded.value;

const SELF = toChecksum("0x1111111111111111111111111111111111111111");
const DEPLOYER = toChecksum("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
const VAULT = toChecksum("0x71c7656ec7ab88b098defb751b7401b5f6d8976f");
const OTHER = toChecksum("0x2222222222222222222222222222222222222222");

function template(name: string): Recipe {
  const recipe = loadTemplate(catalog, name);
  if (!recipe.ok) throw new Error(recipe.error);
  return recipe.value;
}

function withArgs(recipe: Recipe, args: Record<string, string>): Recipe {
  if (recipe.init.kind !== "steps") throw new Error("steps only");
  const [first, ...rest] = recipe.init.steps;
  if (!first) throw new Error("no step");
  return { ...recipe, init: { kind: "steps", steps: [{ ...first, args: { ...first.args, ...args } }, ...rest] } };
}

function initData(recipe: Recipe): Hex {
  const analysis = analyze(recipe, catalog, {
    known: [],
    unconfirmed: [],
    refs: { self: SELF, deployer: DEPLOYER },
    deploy: { chainId: 11155111, path: "factory", from: DEPLOYER, salt: `0x${"00".repeat(32)}` },
  });
  const data = analysis.init?.data;
  if (!data) throw new Error("no init data");
  return data;
}

describe("argumentPath", () => {
  test("maps ERC20's decoded MultiInit steps to its plan, the automatic step included", () => {
    const recipe = template("ERC20");
    const plan = planInit(recipe, catalog);
    const decoded = decodeInit(initData(recipe), catalog, { self: SELF, deployer: DEPLOYER });
    if (!decoded.ok) throw new Error(decoded.error);
    expect(decoded.value.steps.map((step) => step.spec)).toEqual(["ERC20Init", "DiamondIntrospectionInit.initImmutable"]);
    expect(argumentPath(plan, 0, "name_")).toBe("steps[0].name_");
    expect(argumentPath(plan, 1, "x")).toBe("auto.x");
    expect(argumentPath(plan, 2, "x")).toBeNull();
    expect(argumentPath(null, 0, "x")).toBeNull();
  });

  test("maps a bundle's tuple arguments under bundle", () => {
    const plan = planInit(template("GovernedVault"), catalog);
    expect(argumentPath(plan, 0, "p.asset")).toBe("bundle.p.asset");
  });

  test("maps a direct single step, and decodeInit marks a reference", () => {
    const recipe = withArgs(template("SafeDiamondCut"), { safe: VAULT });
    const plan = planInit(recipe, catalog);
    const decoded = decodeInit(initData(recipe), catalog, { self: SELF, deployer: DEPLOYER });
    if (!decoded.ok) throw new Error(decoded.error);
    const [step] = decoded.value.steps;
    expect(step?.fromRef).toEqual({ admin: "deployer" });
    expect(argumentPath(plan, 0, "safe")).toBe("steps[0].safe");
  });
});

describe("flattenArgs", () => {
  test("writes tuples as dotted names and array items by index", () => {
    expect(flattenArgs({ p: { asset: VAULT, name: "Grant vault" }, owners: [OTHER, VAULT], none: [], ok: true })).toEqual([
      { key: "p.asset", value: VAULT },
      { key: "p.name", value: "Grant vault" },
      { key: "owners[0]", value: OTHER },
      { key: "owners[1]", value: VAULT },
      { key: "none", value: [] },
      { key: "ok", value: true },
    ]);
  });

  test("keeps a reference as one value", () => {
    expect(flattenArgs({ admin: { $ref: "deployer" } })).toEqual([{ key: "admin", value: { $ref: "deployer" } }]);
  });
});

describe("plannedValue", () => {
  test("reads a step argument, a tuple component and an array item", () => {
    const plan = { steps: [{ path: "steps[0]", args: { admin: OTHER, owners: [OTHER, VAULT] } }, { path: "bundle", args: { p: { asset: VAULT } } }] };
    const view = plan as unknown as Parameters<typeof plannedValue>[0];
    expect(plannedValue(view, "steps[0].admin")).toBe(OTHER);
    expect(plannedValue(view, "steps[0].owners[1]")).toBe(VAULT);
    expect(plannedValue(view, "bundle.p.asset")).toBe(VAULT);
    expect(plannedValue(view, "bundle.p.missing")).toBeUndefined();
    expect(plannedValue(view, "steps[3].admin")).toBeUndefined();
  });
});

describe("references and values", () => {
  test("writes references in the review's words, with the address when it resolves", () => {
    expect(refText("self", SELF)).toBe(`this diamond (${SELF})`);
    expect(refText("deployer", undefined)).toBe("deploying account");
  });

  test("writes a decoded reference, a planned one, an address with its ENS name and plain text", () => {
    const refs = { self: SELF, deployer: DEPLOYER };
    const ens: EnsEntry[] = [{ path: "steps[0].safe", name: "vault.eth", address: VAULT }];
    expect(valueText(DEPLOYER.toLowerCase(), { fromRef: "deployer", refs, ens, path: "steps[0].admin" })).toBe(`deploying account (${DEPLOYER})`);
    expect(valueText({ $ref: "self" }, { refs: {}, ens, path: null })).toBe("this diamond");
    expect(valueText(VAULT.toLowerCase(), { refs, ens, path: "steps[0].safe" })).toBe(`vault.eth (${VAULT})`);
    expect(valueText(VAULT.toLowerCase(), { refs, ens, path: "steps[0].admin" })).toBe(VAULT);
    expect(valueText("Example Token", { refs, ens, path: null })).toBe("Example Token");
    expect(valueText(["1", "2"], { refs, ens, path: null })).toBe('["1","2"]');
  });
});

describe("ensEntries", () => {
  const plan = { steps: [{ path: "steps[0]", args: { safe: VAULT, admin: OTHER } }] } as unknown as Parameters<typeof ensEntries>[3];
  const label = (name: string, address: Address, chainId: number) => ({ name, address, chainId });

  test("keeps this project's names for this chain whose field still holds the address", () => {
    const labels = {
      "p1|steps[0].safe": label("vault.eth", VAULT, 11155111),
      "p1|steps[0].admin": label("admin.eth", VAULT, 11155111),
      "p2|steps[0].safe": label("other.eth", VAULT, 11155111),
    };
    expect(ensEntries(labels, "p1", 11155111, plan)).toEqual([{ path: "steps[0].safe", name: "vault.eth", address: VAULT }]);
  });

  test("leaves out a name typed for another chain", () => {
    expect(ensEntries({ "p1|steps[0].safe": label("vault.eth", VAULT, 84532) }, "p1", 11155111, plan)).toEqual([]);
  });
});

describe("recheckLine", () => {
  const entry: EnsEntry = { path: "steps[0].safe", name: "vault.eth", address: VAULT };

  test("says a name still resolves to its address", () => {
    expect(recheckLine(entry, { status: "resolved", address: VAULT.toLowerCase() as Address })).toEqual({
      text: `vault.eth still resolves to ${VAULT}.`,
      changed: false,
    });
  });

  test("flags a name that resolves elsewhere now", () => {
    expect(recheckLine(entry, { status: "resolved", address: OTHER })).toEqual({
      text: `vault.eth now resolves to ${OTHER}, not ${VAULT} as when it was typed. Edit the field to use the new address.`,
      changed: true,
    });
  });

  test("flags a name with no record now, and says why a check couldn't run", () => {
    expect(recheckLine(entry, { status: "resolved", address: null }).changed).toBe(true);
    expect(recheckLine(entry, { status: "failed", reason: "Sepolia's public RPC isn't answering." })).toEqual({
      text: "Couldn't resolve vault.eth again: Sepolia's public RPC isn't answering.",
      changed: false,
    });
  });
});
