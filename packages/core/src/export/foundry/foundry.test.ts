import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fc from "fast-check";
import { keccak256, stringToHex, toFunctionSelector, type Hex } from "viem";
import { analyze } from "../../analysis";
import type { Catalog } from "../../model/catalog";
import type { Recipe } from "../../model/recipe";
import { exportFoundry, scriptContractName } from "./foundry";
import { CREATEX_CODEHASH } from "../../checks/net";
import { planInit } from "../../init/plan/plan";
import { fixtureCatalog, fixtureProject, MINIMAL_PROXY_CODE, minimalFixture, v1Recipes, type Fixture } from "./test-support";

const catalog = fixtureCatalog();
const CHAINS = [11155111, 84532];
const PROXY_CODE = readFileSync(resolve(import.meta.dir, "../../../../../fixtures/catalog/fixture/code/Lattice.creation.hex"), "utf8").trim() as Hex;

function exportOf(fixture: Fixture, extra: Partial<Parameters<typeof exportFoundry>[0]> = {}) {
  return exportFoundry({ ...fixture, studioVersion: "0.1.0", chainIds: CHAINS, ...extra });
}

function textOf(fixture: Fixture, extra: Partial<Parameters<typeof exportFoundry>[0]> = {}): string {
  const out = exportOf(fixture, extra);
  if (!out.ok) throw new Error(out.error);
  return out.value.text;
}

type Token = { kind: "string" | "comment" | "code"; text: string };

/** A small Solidity lexer: string literals (with escapes), line and block comments, and everything else. */
function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      tokens.push({ kind: "comment", text: source.slice(i, stop) });
      i = stop;
    } else if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) throw new Error("unterminated block comment");
      tokens.push({ kind: "comment", text: source.slice(i, end + 2) });
      i = end + 2;
    } else if (source[i] === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"') {
        if (source[j] === "\n") throw new Error(`line break inside a string literal at ${j}`);
        j += source[j] === "\\" ? 2 : 1;
      }
      tokens.push({ kind: "string", text: source.slice(i, j + 1) });
      i = j + 1;
    } else {
      const match = /^(?:[A-Za-z0-9_$]+|\s+|.)/su.exec(source.slice(i));
      const text = match?.[0] ?? source.charAt(i);
      if (text.trim() !== "") tokens.push({ kind: "code", text });
      i += text.length;
    }
  }
  return tokens;
}

/** The code tokens, with string and comment contents blanked and the contract name normalized. */
function shape(source: string, contract: string): string[] {
  return lex(source).map((token) => (token.kind === "code" ? (token.text === contract ? "<Contract>" : token.text) : `<${token.kind}>`));
}

describe("exportFoundry", () => {
  // The snapshot pins C7a's own structure only: a catalog, recipe and analysis written by hand in test-support.ts,
  // with the recipe hash (C1's) masked. Fixture recipes are checked below with composed assertions.
  for (const path of ["factory", "createx"] as const) {
    test(`structure snapshot through ${path}`, () => {
      const fixture = minimalFixture(path);
      const out = exportOf(fixture, path === "createx" ? { proxyCreationCode: MINIMAL_PROXY_CODE } : {});
      if (!out.ok) throw new Error(out.error);
      expect(out.value.filename).toBe("DeployMinimal.s.sol");
      expect(out.value.mime).toBe("text/plain");
      expect(out.value.text.replaceAll(fixture.analysis.recipeHash, "<recipe hash>")).toMatchSnapshot();
    });
  }

  for (const name of v1Recipes(catalog)) {
    for (const path of ["factory", "createx"] as const) {
      test(`${name} through ${path}: every plan entry, selector, codehash and init call`, () => {
        const fixture = fixtureProject(catalog, name, { path, scope: path === "factory" ? "every-chain" : "this-chain" });
        const out = exportOf(fixture, path === "createx" ? { proxyCreationCode: PROXY_CODE } : {});
        if (!out.ok) throw new Error(out.error);
        const text = out.value.text;
        expect(out.value.filename).toBe(`Deploy${name}.s.sol`);
        expect(text).toContain(`bytes32 internal constant RECIPE_HASH = ${fixture.analysis.recipeHash};`);
        expect(text.match(/FacetCut\([A-Z0-9_]+_ADDRESS, FacetCutAction\.Add, selectors\);/g)?.length).toBe(fixture.analysis.plan.length);
        for (const entry of fixture.analysis.plan) {
          expect(text).toContain(`//   ${entry.facet} ${entry.version}, `);
          expect(text).toContain(`// ${entry.facet} ${entry.version}\n        selectors = new bytes4[](${entry.selectors.length});`);
          expect(text).toContain(entry.address);
          expect(text).toContain(entry.codehash);
          for (const selector of entry.selectors) expect(text).toContain(`bytes4(${selector});`);
        }
        const steps = planInit(fixture.project.recipe, catalog).steps;
        for (const step of steps) expect(text).toContain(`//   ${step.contract}.${step.fn}\n`);
        if (path === "createx") {
          expect(text).toContain(`bytes32 internal constant CREATEX_CODEHASH = ${CREATEX_CODEHASH};`);
          expect(text).toContain('_expect("CreateX", CREATEX, CREATEX_CODEHASH);');
        } else {
          expect(text).toContain('_expect("LatticeFactory", config.factory, config.factoryCodehash);');
        }
      });
    }
  }

  test("the run log prints a comment-safe project name, never the raw one", () => {
    const base = fixtureProject(catalog, "ERC20");
    const name = "Vault\u001b]8;;https://evil\u0007x\u001b[2J\u202E\n";
    const text = textOf({ ...base, project: { ...base.project, name } });
    expect(text).toContain('string internal constant PROJECT = "Vault\\\\u001b]8;;https://evil\\\\u0007x\\\\u001b[2J\\\\u202e";');
    expect(text).toContain('console.log("Deployed", PROJECT, "at", diamond);');
  });

  test("the same inputs give the same bytes, and the inputs are left as they were", () => {
    const fixture = fixtureProject(catalog, "GovernedVault");
    const before = JSON.stringify(fixture);
    const first = textOf(fixture);
    expect(textOf(fixture)).toBe(first);
    expect(textOf(structuredClone(fixture))).toBe(first);
    expect(JSON.stringify(fixture)).toBe(before);
  });

  test("the inlined interfaces have the selectors Lattice and CreateX use (C5c's 0x533677de and 0x00d84acb)", () => {
    expect(toFunctionSelector("deploy((bytes32,uint64)[],(address,uint8,bytes4[])[],address,bytes,bytes32)")).toBe("0x533677de");
    expect(toFunctionSelector("deployCreate3AndInit(bytes32,bytes,bytes,(uint256,uint256))")).toBe("0x00d84acb");
    expect(toFunctionSelector("predict(address,bytes32)")).toBe("0x64fb6f5e");
    const factory = textOf(fixtureProject(catalog, "ERC20"));
    expect(factory).toContain("    function deploy(\n        RecipeEntry[] calldata entries,\n        FacetCut[] calldata customCuts,");
    expect(factory).toContain("struct RecipeEntry {\n    bytes32 nameHash;\n    uint64 version;\n}");
    expect(factory).toContain("struct FacetCut {\n    address facetAddress;\n    FacetCutAction action;\n    bytes4[] functionSelectors;\n}");
    const createx = textOf(fixtureProject(catalog, "ERC20", { path: "createx" }), { proxyCreationCode: PROXY_CODE });
    expect(createx).toContain("function deployCreate3AndInit(bytes32 salt, bytes memory initCode, bytes memory data, Values memory values)");
  });

  test("imports only forge-std and uses no FFI", () => {
    for (const name of v1Recipes(catalog)) {
      const text = textOf(fixtureProject(catalog, name));
      const imports = text.split("\n").filter((line) => line.startsWith("import "));
      expect(imports).toEqual(['import {Script} from "forge-std/Script.sol";', 'import {console} from "forge-std/console.sol";']);
      expect(text).not.toMatch(/\bffi\b/i);
      expect(text).toContain("vm.startBroadcast();");
      expect(text).toContain("(, address deployer,) = vm.readCallers();");
    }
  });

  test("the header carries the recipe hash, catalog, pinned versions, Studio version, command, verification and what's left out", () => {
    const fixture = fixtureProject(catalog, "GovernedVault");
    const text = textOf(fixture);
    const header = text.slice(0, text.indexOf("pragma solidity"));
    expect(header).toContain(`// Recipe hash: ${fixture.analysis.recipeHash}`);
    expect(header).toContain(`// Catalog: Lattice fixture at commit ${catalog.lattice.commit}, catalog hash ${catalog.hash}`);
    expect(header).toContain("Generated by Lattice Studio 0.1.0.");
    expect(header).toContain("//   forge script DeployGovernedVault.s.sol --rpc-url $RPC_URL --account deployer --broadcast");
    expect(header).toContain("FOUNDRY_PROFILE=ci forge verify-contract <diamond> src/Lattice.sol:Lattice --verifier sourcify");
    expect(header).toContain("//   Deploying missing shared contracts: use Deploy missing contracts… in Lattice Studio or the lattice-studio CLI.");
    expect(header).not.toContain("DeployRelease");
    for (const entry of fixture.analysis.plan) expect(header).toContain(`//   ${entry.facet} ${entry.version}, ${entry.selectors.length} selector`);
    expect(header).toContain("// Chains: 84532, 11155111");
  });

  test("every routed selector is a bytes4 literal with its signature in a comment, and every cut is an Add", () => {
    const fixture = fixtureProject(catalog, "GovernedVault");
    const text = textOf(fixture);
    for (const entry of fixture.analysis.plan) {
      const facet = catalog.facets.find((f) => f.name === entry.facet);
      for (const selector of entry.selectors) {
        const signature = facet?.selectors.find((s) => s.hex.toLowerCase() === selector)?.signature ?? "";
        expect(text).toMatch(new RegExp(`selectors\\[\\d+\\] = bytes4\\(${selector}\\); // ${signature.replace(/[()[\]]/g, "\\$&")}\\n`));
      }
    }
    expect(text.match(/FacetCutAction\.Add/g)?.length).toBe(fixture.analysis.plan.length);
    expect(text).not.toMatch(/FacetCutAction\.(Replace|Remove)/);
  });

  test("says which selectors are excluded and which placed facets route nothing", () => {
    const fixture = fixtureProject(catalog, "ERC20");
    const excluded = catalog.facets.find((f) => f.name === "ERC20")?.selectors.at(-1)?.hex ?? "0x00000000";
    const recipe: Recipe = { ...fixture.project.recipe, exclude: [excluded] };
    const analysis = analyze(recipe, catalog, { known: [], unconfirmed: [] });
    expect(analysis.problems.filter((p) => p.severity === "blocker")).toEqual([]);
    const text = textOf({ ...fixture, project: { ...fixture.project, recipe }, analysis });
    expect(text).toContain(`//   Excluded selectors: ${excluded.toLowerCase()}`);
    expect(text).not.toContain(`bytes4(${excluded.toLowerCase()})`);
    // A placed facet with no Add in the plan is listed as left out.
    const dropped = fixture.analysis.plan.at(-1)?.facet ?? "";
    const partial = { ...fixture, analysis: { ...fixture.analysis, plan: fixture.analysis.plan.slice(0, -1) } };
    expect(textOf(partial)).toContain(`//   Facets that route no selector: ${dropped}`);
  });

  test("picks per-chain constants by block.chainid: a chain's own factory, or the canonical one", () => {
    const own = { address: "0x000000000000000000000000000000000000bEEF", codehash: keccak256("0x01"), buildCommit: "abc1234", proxyStandardJson: catalog.proxy.standardJson, proxyInitCodeHash: keccak256("0x02") } as const;
    const withChain: Catalog = { ...catalog, chains: [{ chainId: 8453, factory: own }] };
    const fixture = { ...fixtureProject(catalog, "ERC20"), catalog: withChain };
    const text = textOf(fixture, { chainIds: [8453, 11155111, 11155111] });
    expect(text).toContain("if (block.chainid == 8453) {\n            config.factory = 0x000000000000000000000000000000000000bEEF;");
    expect(text).toContain(`config.proxyInitCodeHash = ${own.proxyInitCodeHash};`);
    expect(text).toContain(`if (block.chainid == 11155111) {\n            config.factory = ${catalog.factory.address};`);
    expect(text).toContain('string internal constant SUPPORTED_CHAINS = "8453, 11155111";');
    expect(text).toContain("revert UnsupportedChain(block.chainid, SUPPORTED_CHAINS);");
    expect(text).toContain("// Chain 8453 has its own LatticeFactory: verify from a checkout at commit abc1234 instead.");
    expect(text).not.toContain("31337");
    expect(textOf(fixtureProject(catalog, "ERC20"), { chainIds: [31337] })).toContain("block.chainid == 31337");
  });

  test("refuses with blockers, a stale analysis, no chains or a bad chain id", () => {
    const fixture = fixtureProject(catalog, "GovernedVault");
    const blocker = { ...fixture.analysis.problems[0], severity: "blocker" as const };
    const blocked = { ...fixture, analysis: { ...fixture.analysis, problems: [blocker as (typeof fixture.analysis.problems)[number], blocker as (typeof fixture.analysis.problems)[number]] } };
    expect(exportOf(blocked)).toEqual({ ok: false, error: "Resolve 2 blockers to export." });
    const one = { ...fixture, analysis: { ...fixture.analysis, problems: [blocker as (typeof fixture.analysis.problems)[number]] } };
    expect(exportOf(one)).toEqual({ ok: false, error: "Resolve 1 blocker to export." });
    const stale = { ...fixture, analysis: { ...fixture.analysis, recipeHash: keccak256("0x") } };
    expect(exportOf(stale)).toEqual({ ok: false, error: "The analysis is for another version of this recipe. Check the recipe again, then export." });
    expect(exportOf(fixture, { chainIds: [] })).toEqual({ ok: false, error: "No chains to export for. Choose at least one chain." });
    expect(exportOf(fixture, { chainIds: [1.5] }).ok).toBe(false);
  });

  test("the CreateX path needs the Lattice proxy's creation code, and checks it against the catalog", () => {
    const fixture = fixtureProject(catalog, "ERC20", { path: "createx" });
    expect(exportOf(fixture)).toEqual({
      ok: false,
      error: "The CreateX script needs the Lattice proxy's creation code. Load the catalog's code, then export.",
    });
    const wrong = exportOf(fixture, { proxyCreationCode: stringToHex("fixture:NotLattice") });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toContain(catalog.proxy.initCodeHash);
    const text = textOf(fixture, { proxyCreationCode: PROXY_CODE });
    expect(text).toContain(`bytes internal constant LATTICE_CREATION_CODE = hex"${PROXY_CODE.slice(2)}";`);
    expect(text).toContain("ICreateX(CREATEX).deployCreate3AndInit(salt, LATTICE_CREATION_CODE, initialize, values)");
    // The factory path doesn't need it.
    expect(exportOf(fixtureProject(catalog, "ERC20")).ok).toBe(true);
  });

  test("passes C4b's refusal through for an init deployed per use (Unsupported in v1)", () => {
    const fixture = fixtureProject(catalog, "ERC20");
    const recipe: Recipe = { ...fixture.project.recipe, init: { kind: "steps", steps: [{ spec: "AccountInit", args: { owner: { $ref: "deployer" } } }] } };
    const analysis = { ...analyze(recipe, catalog, { known: [], unconfirmed: [] }), problems: [] };
    const out = exportOf({ ...fixture, project: { ...fixture.project, recipe }, analysis });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.startsWith("Unsupported in v1")).toBe(true);
  });

  test("resolves references in the script: This diamond is the predicted address, the deploying account the broadcaster", () => {
    const text = textOf(fixtureProject(catalog, "SafeDiamondCut"));
    expect(text).toContain("(address init, bytes memory initCalldata) = _init(deployer);");
    expect(text).toMatch(/function _initStep0\(address deployer\) internal pure returns \(bytes memory data\) \{\n\s+data = abi\.encodeWithSelector\(\n\s+bytes4\(0x[0-9a-f]{8}\), deployer, /);
  });
});

describe("hostile project names", () => {
  test("the contract and file names are sanitized to [A-Za-z0-9_]", () => {
    expect(scriptContractName("GovernedVault (shared)")).toBe("DeployGovernedVaultShared");
    expect(scriptContractName('x"; } contract Evil { function f() {} /*')).toBe("DeployXContractEvilFunctionF");
    expect(scriptContractName("")).toBe("DeployDiamond");
    expect(scriptContractName("\u202E\u2066")).toBe("DeployDiamond");
  });

  test("a name never escapes its string literal or comment: the code tokens match a plain name's", () => {
    const base = fixtureProject(catalog, "GovernedVault");
    const plain = textOf({ ...base, project: { ...base.project, name: "Plain" } });
    const plainShape = shape(plain, "DeployPlain");
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ unit: "binary", maxLength: 40 }),
          fc.constantFrom('"; selfdestruct(payable(msg.sender)); "', "*/ contract X {} /*", "a\nb\r\nc", "\u202Etxt\u2066", "\\\"", "// x"),
        ),
        (name) => {
          const out = exportOf({ ...base, project: { ...base.project, name } });
          if (!out.ok) throw new Error(out.error);
          const contract = scriptContractName(name);
          expect(out.value.filename).toBe(`${contract}.s.sol`);
          expect(contract).toMatch(/^Deploy[A-Za-z0-9_]*$/);
          expect(shape(out.value.text, contract)).toEqual(plainShape);
        },
      ),
      { numRuns: 150 },
    );
  });
});
