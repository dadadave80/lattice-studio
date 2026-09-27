import { describe, expect, test } from "bun:test";
import { decodeFunctionData, keccak256, stringToHex } from "viem";
import { buildSalt, CREATEX, createxPredict, factoryPredict } from "../../address";
import { CREATEX_ABI, LATTICE_FACTORY_ABI, LATTICE_INITIALIZE_ABI } from "../../deploy";
import { normalizeRecipe, recipeHash } from "../../canonical";
import { lintCopy } from "../../format";
import { decodeInit, UNSUPPORTED_IN_V1 } from "../../init/encode";
import type { Catalog } from "../../model/catalog";
import type { ChainState } from "../../model/chain";
import { toChecksum, type Address, type Hex } from "../../model/hex";
import type { SafeBatchArgs } from "../../model/io";
import type { Arg, Recipe } from "../../model/recipe";
import { loadTemplate } from "../../plan";
import { loadFixtureCatalog, makeShard } from "../../testing";
import { batchChecksum, hasValidChecksum, serializeForChecksum, withChecksum, type BatchFile } from "./checksum";
import { exportSafeBatch, plainText, SAFE_LABEL_MAX, safeBatchTarget } from "./index";

const SAFE: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"; // Anvil account 2, standing in for a Safe
const OTHER: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"; // Anvil account 3
const ASSET: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ENTROPY: Hex = "0x0102030405060708090a0b";
const NOW = 1_790_000_000_000;
const SEPOLIA = 11155111;
const STUDIO = "1.0.0-test";

const fixture = loadFixtureCatalog();
if (!fixture.ok) throw new Error(fixture.error);
const catalog: Catalog = fixture.value;

function template(name: string, fill: (recipe: Recipe) => void = () => {}): Recipe {
  const loaded = loadTemplate(catalog, name);
  if (!loaded.ok) throw new Error(loaded.error);
  const recipe = structuredClone(loaded.value);
  fill(recipe);
  return recipe;
}

/** SafeDiamondCut with its `safe` argument filled; `admin` stays `{$ref:"deployer"}` unless `admin` is given. */
function safeDiamondCut(admin?: Arg): Recipe {
  return template("SafeDiamondCut", (recipe) => {
    if (recipe.init.kind !== "steps") throw new Error("SafeDiamondCut's init should be steps");
    for (const step of recipe.init.steps) {
      if (step.spec !== "SafeDiamondCutInit") continue;
      step.args["safe"] = OTHER;
      if (admin !== undefined) step.args["admin"] = admin;
    }
  });
}

function governedVault(): Recipe {
  return template("GovernedVault", (recipe) => {
    if (recipe.init.kind !== "bundle") throw new Error("GovernedVault's init should be a bundle");
    const p = recipe.init.args["p"];
    if (p === undefined || typeof p !== "object" || Array.isArray(p) || p === null || "$ref" in p) throw new Error("p should be a struct");
    p["asset"] = ASSET;
  });
}

function sepolia(over: Partial<ChainState> = {}): ChainState {
  return {
    chainId: SEPOLIA, name: "Sepolia", online: true, probedAt: "2026-09-23T00:00:00Z",
    deployer: { present: true }, shared: {}, simulate: true, codeAt: {}, ...over,
  };
}

function args(over: Partial<SafeBatchArgs> = {}): SafeBatchArgs {
  return {
    recipe: safeDiamondCut(), catalog, safe: SAFE, chainId: SEPOLIA, entropy: ENTROPY,
    scope: "every-chain", path: "factory", now: NOW, chain: sepolia(), studioVersion: STUDIO, ...over,
  };
}

function exported(over: Partial<SafeBatchArgs> = {}) {
  const result = exportSafeBatch(args(over));
  if (!result.ok) throw new Error(result.error);
  return { ...result.value, file: JSON.parse(result.value.text) as BatchFile };
}

function only(file: BatchFile) {
  expect(file.transactions).toHaveLength(1);
  const [tx] = file.transactions;
  if (tx?.data === undefined) throw new Error("the batch should carry one transaction with data");
  return { ...tx, data: tx.data as Hex };
}

function decodeFactory(data: Hex) {
  const decoded = decodeFunctionData({ abi: LATTICE_FACTORY_ABI, data });
  expect(decoded.functionName).toBe("deploy");
  const [, , init, initCalldata, salt] = decoded.args as readonly [unknown, unknown, Address, Hex, Hex];
  return { init, initCalldata, salt };
}

const predictFactory = (from: Address, salt: Hex) =>
  factoryPredict({ factory: catalog.factory.address, proxyInitCodeHash: catalog.proxy.initCodeHash, from, salt });

describe("the Transaction Builder's checksum", () => {
  test("serializes objects as sorted keys then values, each followed by a comma", () => {
    expect(serializeForChecksum({ b: 1, a: [true, "x"], c: null })).toBe('{["a","b","c"][true,"x"],1,null,}');
    expect(serializeForChecksum([])).toBe("[]");
    expect(serializeForChecksum({})).toBe("{[]}");
    expect(serializeForChecksum("0x")).toBe('"0x"');
  });

  test("writes undefined as null, so a checksum survives JSON's round trip", () => {
    expect(serializeForChecksum({ a: undefined })).toBe('{["a"]null,}');
    expect(serializeForChecksum([undefined])).toBe("[null]");
  });

  test("ignores meta.name and changes with anything else", () => {
    const file: BatchFile = {
      version: "1.0", chainId: "1", createdAt: 1, meta: { name: "A", description: "" },
      transactions: [{ to: SAFE, value: "0", data: "0x" }],
    };
    const base = batchChecksum(file);
    expect(batchChecksum({ ...file, meta: { ...file.meta, name: "B" } })).toBe(base);
    expect(batchChecksum({ ...file, chainId: "2" })).not.toBe(base);
    expect(batchChecksum({ ...file, transactions: [{ to: SAFE, value: "1", data: "0x" }] })).not.toBe(base);
    const expected = keccak256(stringToHex(
      '{["chainId","createdAt","meta","transactions","version"]"1",1,{["description","name"]"",null,},' +
      `[{["data","to","value"]"0x","${SAFE}","0",}],"1.0",}`,
    ));
    expect(base).toBe(expected);
  });

  // The Transaction Builder's own vector (safe-wallet-monorepo apps/tx-builder/src/lib/checksum.test.ts:65,
  // 0x86c8…ce7c) needs its fixture file, which this worktree couldn't fetch: paste the fixture and the full hash
  // here as `expect(batchChecksum(fixture)).toBe("0x86c8…ce7c")`.
  test.todo("reproduces the Transaction Builder's own test vector (checksum.test.ts:65)", () => {});

  test("withChecksum sets a checksum hasValidChecksum accepts, and an edit breaks it", () => {
    const file = withChecksum({ version: "1.0", chainId: "1", createdAt: 1, meta: { name: "A" }, transactions: [] });
    expect(file.meta.checksum).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hasValidChecksum(file)).toBe(true);
    expect(hasValidChecksum({ ...file, meta: { ...file.meta, name: "renamed" } })).toBe(true);
    expect(hasValidChecksum({ ...file, createdAt: 2 })).toBe(false);
    expect(withChecksum(file)).toEqual(file);
  });
});

describe("exportSafeBatch", () => {
  test("snapshot: SafeDiamondCut on Sepolia through LatticeFactory", () => {
    const batch = exported();
    expect(batch.filename).toBe("SafeDiamondCut.safe.json");
    expect(batch.mime).toBe("application/json");
    expect(batch.text).toMatchSnapshot();
  });

  test("snapshot: GovernedVault through CreateX on this chain only", () => {
    const code = "0x6080604052348015600e575f5ffd5b50" as Hex;
    const cat: Catalog = { ...catalog, proxy: { ...catalog.proxy, initCodeHash: keccak256(code) } };
    const result = exportSafeBatch(args({ catalog: cat, recipe: governedVault(), path: "createx", scope: "this-chain", proxyCreationCode: code }));
    if (!result.ok) throw new Error(result.error);
    expect(result.value.text).toMatchSnapshot();
  });

  test("Transaction Builder 1.0 shapes: strings for chainId and value, milliseconds for createdAt", () => {
    const { file } = exported();
    expect(file.version).toBe("1.0");
    expect(file.chainId).toBe("11155111");
    expect(file.createdAt).toBe(NOW);
    const tx = only(file);
    expect(tx.value).toBe("0");
    expect(tx.to).toBe(catalog.factory.address);
    expect(file.meta.createdFromSafeAddress).toBe(SAFE);
    expect(hasValidChecksum(file)).toBe(true);
  });

  test("the salt starts with the Safe, and the Safe's predicted address is the diamond", () => {
    const { file } = exported();
    const { salt } = decodeFactory(only(file).data);
    expect(salt).toBe(buildSalt(SAFE, "every-chain", ENTROPY));
    expect(salt.slice(0, 42)).toBe(SAFE.toLowerCase());
    expect(file.meta.description).toContain(predictFactory(SAFE, salt));
  });

  test("references resolve for the Safe: deployer is the Safe, this diamond its predicted address", () => {
    const salt = buildSalt(SAFE, "every-chain", ENTROPY);
    const self = predictFactory(SAFE, salt);
    const refs = { self, deployer: SAFE };

    const deployer = decodeFactory(only(exported().file).data);
    const byDeployer = decodeInit(deployer.initCalldata, catalog, refs);
    if (!byDeployer.ok) throw new Error(byDeployer.error);
    expect(byDeployer.value.steps[0]?.args["admin"]).toBe(SAFE);
    expect(byDeployer.value.steps[0]?.fromRef["admin"]).toBe("deployer");

    const selfRef = decodeFactory(only(exported({ recipe: safeDiamondCut({ $ref: "self" }) }).file).data);
    const bySelf = decodeInit(selfRef.initCalldata, catalog, refs);
    if (!bySelf.ok) throw new Error(bySelf.error);
    expect(bySelf.value.steps[0]?.args["admin"]).toBe(self);
    expect(bySelf.value.steps[0]?.fromRef["admin"]).toBe("self");
  });

  test("another Safe gets another salt, address and init", () => {
    const mine = exported({ recipe: safeDiamondCut({ $ref: "self" }) });
    const theirs = exported({ recipe: safeDiamondCut({ $ref: "self" }), safe: OTHER });
    const a = decodeFactory(only(mine.file).data);
    const b = decodeFactory(only(theirs.file).data);
    expect(b.salt.slice(0, 42)).toBe(OTHER.toLowerCase());
    expect(b.initCalldata).not.toBe(a.initCalldata);
    expect(theirs.file.meta.name).toContain(predictFactory(OTHER, b.salt));
  });

  test("the Safe, the chain and the predicted address appear in the meta", () => {
    const { file } = exported();
    const self = predictFactory(SAFE, buildSalt(SAFE, "every-chain", ENTROPY));
    for (const field of [file.meta.name, file.meta.description ?? ""]) {
      expect(field).toContain(SAFE);
      expect(field).toContain("Sepolia");
      expect(field).toContain(self);
    }
    expect(file.meta.description).toContain("chain 11155111");
    expect(file.meta.description).toContain("checks neither the Safe nor the chain");
  });

  test("without a probe of this chain, the meta names the chain by id", () => {
    const { chain: _probe, ...unprobed } = args();
    const none = exportSafeBatch(unprobed);
    const stale = exportSafeBatch(args({ chain: sepolia({ chainId: 1, name: "Ethereum" }) }));
    const blank = exportSafeBatch(args({ chain: sepolia({ name: " ​\n" }) }));
    for (const result of [none, stale, blank]) {
      if (!result.ok) throw new Error(result.error);
      const file = JSON.parse(result.value.text) as BatchFile;
      const description = file.meta.description ?? "";
      expect(file.meta.name).toEndWith(" · chain 11155111");
      expect(file.meta.name).not.toContain("Ethereum");
      expect(description).toContain(" on chain 11155111, from Safe ");
      expect(description).not.toMatch(/\(chain 11155111\)/);
      expect(description).not.toContain("Chain 11155111");
    }
  });

  test("this-chain scope warns about other chains too", () => {
    expect(exported({ scope: "this-chain" }).file.meta.description).toContain("from another Safe or on another chain");
    expect(exported().file.meta.description).not.toContain("on another chain");
  });

  test("the description is headed with the Studio version, recipe hash and catalog tag, and says what it leaves out", () => {
    const { file } = exported();
    const description = file.meta.description ?? "";
    const [head] = description.split("\n");
    expect(head).toMatch(/^Lattice Studio 1\.0\.0-test · recipe 0x[0-9a-f]{64} · Lattice fixture$/);
    expect(head).toContain(recipeHash(normalizeRecipe(safeDiamondCut(), catalog)));
    expect(description).toContain("Leaves out deploying missing shared contracts");
    expect(lintCopy(description)).toEqual([]);
    expect(lintCopy(file.meta.name)).toEqual([]);
    expect(exported({ studioVersion: "1.0.1" }).text).not.toBe(exported().text);
  });

  test("a placed facet that routes nothing is named in the description, before the shared contracts line (spec L509, PA bug 2)", () => {
    const recipe = governedVault();
    recipe.facets.push("ERC20Pausable");
    const { file } = exported({ recipe });
    const lines = (file.meta.description ?? "").split("\n");
    const omitted = "Placed but routes nothing, so no Add is cut for it: ERC20Pausable.";
    expect(lines).toContain(omitted);
    expect(lines.indexOf(omitted)).toBe(lines.length - 2);
    expect(lintCopy(file.meta.description ?? "")).toEqual([]);
    // Without such a facet the line is absent.
    expect(exported({ recipe: governedVault() }).file.meta.description).not.toContain("Placed but routes nothing");
    expect(exported().file.meta.description).not.toContain("Placed but routes nothing");
  });

  test("names from a person or a file reach the meta as one plain line", () => {
    const hostile = "Vault\n‮evil​\t\u0000name end";
    const recipe = { ...safeDiamondCut(), name: hostile };
    const { file, text } = exported({
      recipe,
      chain: sepolia({ name: "Sepo\r\nlia‮" }),
      studioVersion: "1.0.0\u0007beta",
    });
    const fields = [file.meta.name, ...(file.meta.description ?? "").split("\n")];
    for (const field of fields) expect(field).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
    expect(file.meta.name).toContain("Deploy Vault evil name end to ");
    expect(file.meta.name).toContain("· Sepo lia");
    expect(file.meta.description).toStartWith("Lattice Studio 1.0.0 beta · ");
    expect(file.meta.description?.split("\n")).toHaveLength(5);
    expect(hasValidChecksum(file)).toBe(true);
    expect(JSON.parse(text)).toEqual(file);
    expect(plainText("​\n", "fallback")).toBe("fallback");
  });

  test("CreateX: one call from the Safe to CreateX with the Safe-prefixed raw salt", () => {
    const code = "0x6080604052348015600e575f5ffd5b50" as Hex;
    const cat: Catalog = { ...catalog, proxy: { ...catalog.proxy, initCodeHash: keccak256(code) } };
    const result = exportSafeBatch(args({ catalog: cat, path: "createx", scope: "this-chain", proxyCreationCode: code }));
    if (!result.ok) throw new Error(result.error);
    const file = JSON.parse(result.value.text) as BatchFile;
    const tx = only(file);
    expect(tx.to).toBe(CREATEX);
    const decoded = decodeFunctionData({ abi: CREATEX_ABI, data: tx.data });
    const [salt, initCode, data] = decoded.args as readonly [Hex, Hex, Hex, unknown];
    expect(salt).toBe(buildSalt(SAFE, "this-chain", ENTROPY));
    expect(initCode).toBe(code);
    expect(decodeFunctionData({ abi: LATTICE_INITIALIZE_ABI, data }).functionName).toBe("initialize");
    expect(file.meta.name).toContain(createxPredict({ from: SAFE, salt, chainId: SEPOLIA }));
  });

  test("CreateX without the proxy's creation code, or with the wrong code, is refused", () => {
    const missing = exportSafeBatch(args({ path: "createx" }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("creation code");
    const wrong = exportSafeBatch(args({ path: "createx", proxyCreationCode: "0x00" }));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toContain("doesn't match");
  });

  test("registry records on this chain send whole facets as registry entries; a probe of another chain is ignored", () => {
    const plain = decodeFunctionData({ abi: LATTICE_FACTORY_ABI, data: only(exported().file).data });
    const records = Object.fromEntries(
      catalog.facets.map((facet) => [`${facet.name}@${facet.release.version}`, { facet: facet.release.address, codehash: facet.release.codehash }]),
    );
    const listed = decodeFunctionData({ abi: LATTICE_FACTORY_ABI, data: only(exported({ chain: sepolia({ registry: { records } }) }).file).data });
    const stale = decodeFunctionData({ abi: LATTICE_FACTORY_ABI, data: only(exported({ chain: sepolia({ chainId: 1, registry: { records } }) }).file).data });
    const entries = (d: typeof plain) => (d.args[0] as readonly unknown[]).length;
    expect(entries(plain)).toBe(0);
    expect(entries(listed)).toBeGreaterThan(0);
    expect(entries(stale)).toBe(0);
  });

  test("the same inputs give the same bytes", () => {
    expect(exported().text).toBe(exported().text);
    expect(exported({ now: NOW + 1 }).text).not.toBe(exported().text);
  });

  test("the file name follows the recipe's name", () => {
    expect(exported({ recipe: { ...safeDiamondCut(), name: "Treasury vault / v2" } }).filename).toBe("Treasury-vault-v2.safe.json");
    const { name: _dropped, ...unnamed } = safeDiamondCut();
    expect(exported({ recipe: unnamed }).filename).toBe("diamond.safe.json");
  });

  test("refuses bad inputs with a reason instead of throwing", () => {
    const cases: Partial<SafeBatchArgs>[] = [
      { safe: "0x1234" as Address },
      { chainId: 0 },
      { chainId: 1.5 },
      { now: -1 },
      { now: Number.NaN },
      { entropy: "0x01" },
      { safe: "0x0000000000000000000000000000000000000000" },
    ];
    for (const over of cases) {
      const result = exportSafeBatch(args(over));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    }
    const zero = exportSafeBatch(args({ safe: "0x0000000000000000000000000000000000000000" }));
    expect(zero).toEqual({ ok: false, error: "The Safe address is the zero address, which no Safe can have. Enter the Safe's address." });
  });

  test("an unconfirmed authority address (LINK-01) or an earlier prediction (AUTH-02) in the context refuses the export", () => {
    const link = exportSafeBatch(args({ context: { known: [], unconfirmed: ["steps[0].safe"], unconfirmedFrom: { "steps[0].safe": "link" } } }));
    expect(link).toEqual({ ok: false, error: "Resolve 1 blocker to export: LINK-01." });
    const stale = exportSafeBatch(args({ context: { known: [OTHER], unconfirmed: [], knownFrom: { [OTHER.toLowerCase()]: { source: "prediction", chainId: SEPOLIA } } } }));
    expect(stale).toEqual({ ok: false, error: "Resolve 1 blocker to export: AUTH-02." });
    expect(exportSafeBatch(args({ context: { known: [], unconfirmed: [] } })).ok).toBe(true);
  });

  test("safeBatchTarget gives the salt and address the batch deploys at, on both paths", () => {
    const code = "0x6080604052348015600e575f5ffd5b50" as Hex;
    const cat: Catalog = { ...catalog, proxy: { ...catalog.proxy, initCodeHash: keccak256(code) } };
    for (const over of [{}, { catalog: cat, path: "createx", scope: "this-chain", proxyCreationCode: code }] as Partial<SafeBatchArgs>[]) {
      const target = safeBatchTarget(args(over));
      if (!target.ok) throw new Error(target.error);
      const { file } = exported(over);
      expect(target.value.salt.slice(0, 42)).toBe(SAFE.toLowerCase());
      expect(file.meta.name).toContain(`to ${target.value.address} ·`);
      expect(only(file).data).toContain(target.value.salt.slice(2));
    }
    expect(safeBatchTarget(args({ safe: "0x0000000000000000000000000000000000000000" })).ok).toBe(false);
    expect(safeBatchTarget(args({ entropy: "0x01" })).ok).toBe(false);
  });

  test("a chain-specific factory: the call and the address follow it, and every-chain batches warn about other chains", () => {
    const factory: Address = "0x1111111111111111111111111111111111111111";
    const proxyInitCodeHash = keccak256("0x60016002");
    const cat: Catalog = {
      ...catalog,
      chains: [...catalog.chains.filter((c) => c.chainId !== SEPOLIA), {
        chainId: SEPOLIA,
        factory: { address: factory, codehash: keccak256("0x01"), buildCommit: "abc1234", proxyStandardJson: makeShard(`json/Factory-${SEPOLIA}.standard.json`), proxyInitCodeHash },
      }],
    };
    const target = safeBatchTarget(args({ catalog: cat }));
    if (!target.ok) throw new Error(target.error);
    expect(target.value.address).toBe(factoryPredict({ factory, proxyInitCodeHash, from: SAFE, salt: target.value.salt }));
    const every = exported({ catalog: cat });
    expect(only(every.file).to).toBe(toChecksum(factory));
    expect(every.file.meta.name).toContain(target.value.address);
    expect(every.file.meta.description).toContain(`${toChecksum(factory)} is Sepolia's own LatticeFactory: on another chain that address may have no code, and the call would do nothing.`);
    expect(exported({ catalog: cat, scope: "this-chain" }).file.meta.description).not.toContain("own LatticeFactory");
    expect(exported().file.meta.description).not.toContain("own LatticeFactory");
  });

  test("a huge recipe name is capped in the meta and the file name", () => {
    const name = `Vault ${"x".repeat(5000)}`;
    const batch = exported({ recipe: { ...safeDiamondCut(), name } });
    const label = /^Deploy (.*) to 0x/.exec(batch.file.meta.name)?.[1] ?? "";
    expect([...label]).toHaveLength(SAFE_LABEL_MAX);
    expect(label.endsWith("…")).toBe(true);
    expect(batch.filename.length).toBeLessThanOrEqual(SAFE_LABEL_MAX + ".safe.json".length);
    expect(batch.filename).toEndWith(".safe.json");
    expect(plainText("short", "x", SAFE_LABEL_MAX)).toBe("short");
  });

  test("refuses a recipe with blockers, naming them", () => {
    const recipe = safeDiamondCut();
    if (recipe.init.kind === "steps") delete recipe.init.steps[0]?.args["safe"];
    const result = exportSafeBatch(args({ recipe }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^Resolve 1 blocker to export: INIT-01\.$|^Resolve \d+ blockers to export: .*INIT-01/);
  });

  test("an init C4b can't encode is refused with C4b's reason", () => {
    const cat: Catalog = {
      ...catalog,
      inits: catalog.inits.map((spec) => (spec.contract === "SafeDiamondCutInit" ? { ...spec, ctorArgs: [{ name: "safe", type: "address" }] } : spec)),
    };
    const result = exportSafeBatch(args({ catalog: cat }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toStartWith(`${UNSUPPORTED_IN_V1}: SafeDiamondCutInit`);
  });
});
