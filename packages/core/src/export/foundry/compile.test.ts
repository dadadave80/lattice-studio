/**
 * The generated scripts against the real toolchain (spec L507-L528, L919): when `forge` and forge-std exist, each
 * v1 recipe's script (both deploy paths) compiles in a temp project with forge-std, passes `forge fmt --check`,
 * and runs under `forge test` harnesses: the init it encodes equals C4b's `encodeInit`, its salt equals C5b's
 * `buildSalt`, `run()` sends exactly the deploy call Studio would build, and each refusal fires. Skipped cleanly
 * without forge.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import fc from "fast-check";
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, stringToHex, toFunctionSelector, type Hex } from "viem";
import { buildSalt, createxPredict, factoryPredict } from "../../address";
import { encodeInit } from "../../init/encode/encode";
import { planInit } from "../../init/plan/plan";
import type { Catalog, InitParam, InitSpec } from "../../model/catalog";
import type { Arg, Recipe } from "../../model/recipe";
import { toChecksum, type Address } from "../../model/hex";
import { commentText, solidityString } from "../escape";
import { exportFoundry } from "./foundry";
import { MISSING_HELP } from "./render";
import { assignLines, callLines, declarationLines } from "./solidity";
import { analyze } from "../../analysis";
import { fixtureCatalog, fixtureProject, v1Recipes, type Fixture } from "./test-support";

const ROOT = resolve(import.meta.dir, "../../../../..");

/** `LATTICE_DIR` from the environment, then from the repo root's `.env.local` (contracts §2, Ports and environment). */
function latticeDirFromEnvFile(): string | undefined {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith("LATTICE_DIR="));
  return line?.slice("LATTICE_DIR=".length).trim();
}

const FORGE = Bun.which("forge");
const LATTICE = [process.env["LATTICE_DIR"], latticeDirFromEnvFile(), join(ROOT, "lattice")].find(
  (dir): dir is string => dir !== undefined && dir !== "" && existsSync(join(dir, "lib/forge-std/src/Script.sol")),
);
const ENABLED = FORGE !== null && LATTICE !== undefined;

/** forge test's default broadcaster (forge-std `DEFAULT_SENDER`). */
const SENDER: Address = "0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38";
const CHAIN = 11155111;
const CHAINS = [CHAIN, 84532];
const FACTORY_ABI = parseAbi([
  "function deploy((bytes32,uint64)[] entries, (address,uint8,bytes4[])[] customCuts, address init, bytes initCalldata, bytes32 salt)",
]);
const CREATEX_ABI = parseAbi(["function deployCreate3AndInit(bytes32 salt, bytes initCode, bytes data, (uint256,uint256) values)"]);
const LATTICE_ABI = parseAbi(["function initialize((address,uint8,bytes4[])[] facetCuts, address init, bytes data)"]);

type Case = { key: string; fixture: Fixture; text: string; contract: string; path: "factory" | "createx"; creation?: Hex };

function run(cwd: string, args: string[]): { code: number; out: string } {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "FOUNDRY_PROFILE") env[k] = v;
  const proc = Bun.spawnSync([FORGE ?? "forge", ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, out: `${proc.stdout.toString()}${proc.stderr.toString()}` };
}

function proxyCode(): Hex {
  return readFileSync(resolve(import.meta.dir, "../../../../../fixtures/catalog/fixture/code/Lattice.creation.hex"), "utf8").trim() as Hex;
}

/** The fixture's invented runtime code for `name`: its codehash is keccak256 of these bytes (fixtures/catalog/provenance.json). */
function fixtureRuntime(name: string): Hex {
  return stringToHex(`fixture:${name}:runtime`);
}

/** Every shared contract the script checks, in its order: name, address, expected codehash. */
function sharedOf(fixture: Fixture, path: "factory" | "createx"): { name: string; address: Address; codehash: Hex }[] {
  const { catalog, analysis, project } = fixture;
  const out: { name: string; address: Address; codehash: Hex }[] = [];
  const add = (name: string, address: Address, codehash: Hex): void => {
    if (!out.some((s) => s.address.toLowerCase() === address.toLowerCase())) out.push({ name, address: toChecksum(address), codehash });
  };
  for (const entry of analysis.plan) add(entry.facet, entry.address, entry.codehash);
  const steps = planInit(project.recipe, catalog).steps;
  const specs = steps.map((step) => catalog.inits.find((spec) => spec.name === step.spec));
  for (const spec of specs) if (spec?.release) add(spec.contract, spec.release.address, spec.release.codehash);
  const multi = catalog.inits.find((spec) => spec.name === "MultiInit");
  if (steps.length > 1 && multi?.release) add(multi.contract, multi.release.address, multi.release.codehash);
  return path === "factory" ? [{ name: "LatticeFactory", address: toChecksum(catalog.factory.address), codehash: catalog.factory.codehash }, ...out] : out;
}

function hexLit(data: Hex): string {
  return `hex"${data.slice(2)}"`;
}

/** A forge-std test contract exercising one generated script. */
function harness(item: Case, catalog: Catalog): string {
  const { fixture, contract, path } = item;
  const { project, analysis } = fixture;
  const salt = buildSalt(SENDER, project.deploy.scope, project.deploy.entropy);
  const predicted =
    path === "factory"
      ? factoryPredict({ factory: catalog.factory.address, proxyInitCodeHash: catalog.proxy.initCodeHash, from: SENDER, salt })
      : createxPredict({ from: SENDER, salt, chainId: CHAIN });
  const init = encodeInit(planInit(project.recipe, catalog), catalog, { self: predicted, deployer: SENDER });
  if (!init.ok) throw new Error(init.error);
  const cuts = analysis.plan.map((entry) => ({ facetAddress: entry.address, action: 0, functionSelectors: entry.selectors }));
  const tuples = cuts.map((cut) => [cut.facetAddress, cut.action, cut.functionSelectors] as const);
  const deployCall =
    path === "factory"
      ? encodeFunctionData({ abi: FACTORY_ABI, functionName: "deploy", args: [[], tuples, init.value.target, init.value.data, salt] })
      : encodeFunctionData({
          abi: CREATEX_ABI,
          functionName: "deployCreate3AndInit",
          args: [salt, item.creation ?? "0x", encodeFunctionData({ abi: LATTICE_ABI, functionName: "initialize", args: [tuples, init.value.target, init.value.data] }), [0n, 0n]],
        });
  const target = path === "factory" ? toChecksum(catalog.factory.address) : "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed";
  const loupeType = [{ type: "tuple[]", components: [{ type: "address" }, { type: "bytes4[]" }] }] as const;
  const facets = [...analysis.plan].reverse().map((entry) => [entry.address, [...entry.selectors].reverse()] as const);
  const loupe = encodeAbiParameters(loupeType, [facets]);
  const first = analysis.plan[0];
  const short = encodeAbiParameters(loupeType, [
    analysis.plan.map((entry, i) => [entry.address, i === 0 ? entry.selectors.slice(1) : entry.selectors] as const),
  ]);
  const shared = sharedOf(fixture, path);
  const initParams = /function _init\(([^)]*)\)/.exec(item.text)?.[1] ?? "";
  const initArgs = initParams
    .split(",")
    .map((p) => p.trim().split(" ")[1])
    .filter((p): p is string => p !== undefined)
    .map((p) => (p === "diamond" ? "diamond" : "deployer"))
    .join(", ");
  const etch = (skip?: string): string =>
    shared
      .map((s) => `        vm.etch(${s.address}, ${s.name === skip ? 'hex"01"' : hexLit(fixtureRuntime(s.name))});`)
      .join("\n") + (path === "createx" ? `\n        vm.etch(${target}, hex"00");` : "");
  const FOREIGN = "0x000000000000000000000000000000000000bEEF";
  const wrongPrediction = "0x000000000000000000000000000000000000dEaD";
  const fewer = encodeAbiParameters(loupeType, [analysis.plan.slice(0, -1).map((entry) => [entry.address, entry.selectors] as const)]);
  const foreign = encodeAbiParameters(loupeType, [
    analysis.plan.map((entry, i) => [i === 0 ? FOREIGN : entry.address, entry.selectors] as const),
  ]);
  const createxAt = `CreateX at ${toChecksum(target)}`;
  const firstAt = `${first?.facet} at ${toChecksum(first?.address ?? FOREIGN)}`;
  const predictMock = (answer: string): string =>
    path === "factory"
      ? `        vm.mockCall(${target}, abi.encodeWithSignature("predict(address,bytes32)", SENDER, bytes32(${salt})), abi.encode(${answer}));`
      : `        vm.mockCall(${target}, abi.encodeWithSelector(bytes4(${toFunctionSelector("function computeCreate3Address(bytes32)")})), abi.encode(${answer}));`;
  // The deploy call runs a mock that checks the calldata, returns the predicted address and only then gives it a
  // loupe, so the script's empty-address check sees no code, as on a real chain.
  const mocks = (deployer: "MockDeployOk" | "MockDeployShort"): string =>
    [
      predictMock(predicted),
      `        vm.mockFunction(${target}, address(new ${deployer}()), abi.encodeWithSelector(bytes4(${deployCall.slice(0, 10)})));`,
    ].join("\n");
  const loupeMock = (data: Hex): string => `        vm.mockCall(${predicted}, abi.encodeWithSelector(bytes4(0x7a0ed627)), ${hexLit(data)});`;
  // Only the factory path can run end to end here: CreateX's real runtime code isn't in the repo, so no etched
  // code can match CREATEX_CODEHASH. Q5 runs the CreateX script on a fork; this harness drives its parts.
  const runTests =
    path === "factory"
      ? `
    function test_addressTaken() public {
${etch()}
${mocks("MockDeployOk")}
        vm.etch(${predicted}, hex"00");
        vm.expectRevert(abi.encodeWithSelector(${contract}.AddressTaken.selector, ${predicted}));
        script.run();
    }

    function test_runSendsTheDeployCall() public {
${etch()}
${mocks("MockDeployOk")}
        assertEq(script.run(), ${predicted});
    }

    function test_runRefusesOtherSelectors() public {
${etch()}
${mocks("MockDeployShort")}
        vm.expectRevert(abi.encodeWithSelector(${contract}.SelectorsDiffer.selector, ${toChecksum(first?.address ?? FOREIGN)}));
        script.run();
    }

    function test_runRefusesAnotherPrediction() public {
${etch()}
${predictMock(wrongPrediction)}
        vm.expectRevert(abi.encodeWithSelector(${contract}.PredictionDiffers.selector, ${predicted}, ${wrongPrediction}));
        script.run();
    }
`
      : `
    function test_createxWithOtherCode() public {
${etch()}
        vm.expectRevert(abi.encodeWithSelector(${contract}.UnexpectedCode.selector, ${solidityString(createxAt)}));
        script.run();
    }
`;
  const mockDeploy = (name: string, facetsData: Hex): string => `contract ${name} {
    fallback(bytes calldata data) external returns (bytes memory) {
        require(keccak256(data) == ${keccak256(deployCall)}, "the deploy call differs from Studio's");
        Vm(address(uint160(uint256(keccak256("hevm cheat code"))))).mockCall(
            ${predicted}, abi.encodeWithSelector(bytes4(0x7a0ed627)), ${hexLit(facetsData)}
        );
        return abi.encode(${predicted});
    }
}`;
  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {${contract}} from "../script/${contract}.s.sol";

${mockDeploy("MockDeployOk", loupe)}

${mockDeploy("MockDeployShort", short)}

contract Exposed is ${contract} {
    function initFor(address diamond, address deployer) external pure returns (address, bytes memory) {
        diamond;
        deployer;
        return _init(${initArgs});
    }

    function saltFor(address deployer) external pure returns (bytes32) {
        return _salt(deployer);
    }

    function predictFor(address deployer, bytes32 salt) external view returns (address) {
        return _predict(_chainConfig(), deployer, salt);
    }

    function deployFor(bytes32 salt, address init, bytes memory data) external returns (address) {
        return _deploy(_chainConfig(), salt, init, data);
    }

    function checkFacetsFor(address diamond) external view {
        _checkFacets(diamond);
    }
}

contract ${contract}Test is Test {
    address constant SENDER = ${SENDER};
    Exposed script;

    function setUp() public {
        vm.chainId(${CHAIN});
        script = new Exposed();
    }

    function test_initEqualsEncodeInit() public view {
        (address target, bytes memory data) = script.initFor(${predicted}, SENDER);
        assertEq(target, ${toChecksum(init.value.target)});
        assertEq(data, ${hexLit(init.value.data)});
    }

    function test_saltEqualsBuildSalt() public view {
        assertEq(script.saltFor(SENDER), bytes32(${salt}));
    }

    function test_unsupportedChain() public {
        vm.chainId(999);
        vm.expectRevert(abi.encodeWithSelector(${contract}.UnsupportedChain.selector, uint256(999), ${solidityString([...CHAINS].sort((a, b) => a - b).join(", "))}));
        script.run();
    }

    function test_missingSharedContracts() public {
        vm.expectRevert(abi.encodeWithSelector(${contract}.MissingSharedContracts.selector, ${solidityString(
          (path === "createx" ? ["CreateX", ...shared.map((s) => s.name)] : shared.map((s) => s.name)).join(", "),
        )}, ${solidityString(MISSING_HELP)}));
        script.run();
    }

    function test_unexpectedCode() public {
${etch(first?.facet)}
        vm.expectRevert(abi.encodeWithSelector(${contract}.UnexpectedCode.selector, ${solidityString(path === "createx" ? `${createxAt}, ${firstAt}` : firstAt)}));
        script.run();
    }

    function test_predictMatches() public {
${etch()}
${predictMock(predicted)}
        assertEq(script.predictFor(SENDER, bytes32(${salt})), ${predicted});
    }

    function test_predictionDiffers() public {
${etch()}
${predictMock(wrongPrediction)}
        vm.expectRevert(abi.encodeWithSelector(${contract}.PredictionDiffers.selector, ${predicted}, ${wrongPrediction}));
        script.predictFor(SENDER, bytes32(${salt}));
    }

    function test_deployCallMatches() public {
${etch()}
${mocks("MockDeployOk")}
        assertEq(script.deployFor(bytes32(${salt}), ${toChecksum(init.value.target)}, ${hexLit(init.value.data)}), ${predicted});
    }

    function test_facetsMatchAsSets() public {
${loupeMock(loupe)}
        script.checkFacetsFor(${predicted});
    }

    function test_facetsDiffer() public {
${loupeMock(fewer)}
        vm.expectRevert(abi.encodeWithSelector(${contract}.FacetsDiffer.selector, uint256(${analysis.plan.length}), uint256(${analysis.plan.length - 1})));
        script.checkFacetsFor(${predicted});
    }

    function test_unexpectedFacet() public {
${loupeMock(foreign)}
        vm.expectRevert(abi.encodeWithSelector(${contract}.UnexpectedFacet.selector, ${FOREIGN}));
        script.checkFacetsFor(${predicted});
    }

    function test_selectorsDiffer() public {
${loupeMock(short)}
        vm.expectRevert(abi.encodeWithSelector(${contract}.SelectorsDiffer.selector, ${toChecksum(first?.address ?? FOREIGN)}));
        script.checkFacetsFor(${predicted});
    }
${runTests}}
`;
}

/**
 * The ERC20 recipe with an invented init of every ABI shape the script writes (nested tuples, dynamic and fixed
 * arrays, bytes, bytesN, signed and unsigned integers, booleans, hostile strings, references inside tuples and
 * arrays) before its own steps, so the script's `abi.encodeWithSelector` must equal viem's for all of them.
 */
function kitchenSink(fixture: Fixture): Fixture {
  const inner: InitParam[] = [
    { name: "label", type: "string", doc: "" },
    { name: "weights", type: "uint8[2]", doc: "" },
  ];
  const params: InitParam[] = [
    {
      name: "config",
      type: "tuple",
      doc: "",
      components: [
        { name: "owner", type: "address", doc: "" },
        { name: "roots", type: "bytes32[]", doc: "" },
        { name: "tick", type: "int24", doc: "" },
        { name: "open", type: "bool", doc: "" },
        { name: "blob", type: "bytes", doc: "" },
        { name: "tiers", type: "tuple[]", doc: "", components: inner },
      ],
    },
    { name: "admins", type: "address[]", doc: "" },
    { name: "names", type: "string[]", doc: "" },
    { name: "tag", type: "bytes4", doc: "" },
    { name: "delta", type: "int256", doc: "" },
    { name: "grid", type: "uint256[][]", doc: "" },
    { name: "empty", type: "bytes", doc: "" },
  ];
  const fn = "init((address,bytes32[],int24,bool,bytes,(string,uint8[2])[]),address[],string[],bytes4,int256,uint256[][],bytes)";
  const contract = "KitchenSinkInit";
  const code = stringToHex(`fixture:${contract}:runtime`);
  const release = { ...fixture.catalog.inits.find((spec) => spec.release)?.release, address: toChecksum("0x00000000000000000000000000000000000c0dE5"), codehash: keccak256(code) } as NonNullable<InitSpec["release"]>;
  const spec: InitSpec = { name: contract, contract, fn, kind: "step", params, initializes: [], after: [], sameCall: [], release };
  const catalog: Catalog = { ...fixture.catalog, inits: [...fixture.catalog.inits, spec] };
  const args: Record<string, Arg> = {
    config: {
      owner: { $ref: "self" },
      roots: [keccak256("0x01"), keccak256("0x02")],
      tick: "-8388608",
      open: true,
      blob: "0xdeadbeef",
      tiers: [
        { label: 'gold"; } /*', weights: ["1", "255"] },
        { label: "\u202Esilver\n", weights: ["0", "7"] },
      ],
    },
    admins: [{ $ref: "deployer" }, "0x71C7656EC7ab88b098defB751B7401B5f6d8976F"],
    names: ["", "café \u{1F600}", "back\\slash"],
    tag: "0x0000abcd",
    delta: "-57896044618658097711785492504343953926634992332820282019728792003956564819968",
    grid: [[], ["1", "115792089237316195423570985008687907853269984665640564039457584007913129639935"]],
    empty: "0x",
  };
  const init = fixture.project.recipe.init;
  const steps = init.kind === "steps" ? init.steps : [];
  const recipe: Recipe = { ...fixture.project.recipe, init: { kind: "steps", steps: [{ spec: contract, args }, ...steps] } };
  const analysis = { ...analyze(recipe, catalog, { known: [], unconfirmed: [] }), problems: [] };
  return { catalog, project: { ...fixture.project, recipe }, analysis };
}

/** A project name and vault name that try to break out of every string and comment they land in. */
const HOSTILE_NAME = 'Vault"; } contract Evil { /* */ \n// \u202Eevil\u2066 \\" café \u{1F600}';

/** Strings no encoder should let through: quotes, backslashes, newlines, comment ends, bidi controls, astral and lone surrogates. */
const HOSTILE = [
  "",
  'Vault"; selfdestruct(payable(msg.sender)); "',
  "back\\slash\\",
  "line\nbreak\r\nand\ttab",
  "*/ contract Evil {} /*",
  "// not a comment",
  "\u202Etxt.exe\u202C and \u2066isolate\u2069",
  "caf\u00e9 \u4e2d\u6587 \u{1F600} \u{10FFFF}",
  "lone \ud800 surrogate \udfff",
  "\u0000\u0001\u001f\u007f\u0085\u2028\u2029",
  "unicode\"\\u0041\"",
];

function escapeContract(strings: readonly string[]): string {
  const cases = strings
    .map((s, i) => {
      const expected = stringToHex(s);
      return `    // ${commentText(s)}
    function test_literal${i}() public pure {
        assertEq(bytes(${solidityString(s)}), ${hexLit(expected)});
    }`;
    })
    .join("\n\n");
  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";

contract EscapeTest is Test {
${cases}
}
`;
}

/** Calls and assignments of every shape, for `forge fmt --check` (it parses, so the file needn't compile). */
function fmtProbe(): string {
  const token = fc.oneof(
    fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,40}$/).map((s) => `v${s}`),
    fc.string({ maxLength: 90 }).map((s) => solidityString(s)),
    fc.constant("0x71C7656EC7ab88b098defB751B7401B5f6d8976F"),
    fc.constant(`hex"${"ab".repeat(3000)}"`),
  );
  const call = fc.record({
    prefix: fc.constantFrom("", "data = ", "cuts[12] = "),
    fn: fc.constantFrom("f", "abi.encodeWithSelector", "FacetCut", "_expect"),
    args: fc.array(token, { maxLength: 9 }),
  });
  const assign = fc.record({ lhs: fc.constantFrom("v.name", "config.proxyCommit", "string memory projectName", "calls[3]"), value: token });
  const declaration = fc.record({
    decl: fc.constantFrom("string internal constant PROJECT", "bytes32 internal constant DIAMOND_LOUPE_FACET_CODEHASH", "address internal constant A"),
    value: token,
  });
  const calls = fc.sample(call, { seed: 7, numRuns: 400 });
  const assigns = fc.sample(assign, { seed: 11, numRuns: 150 });
  const declarations = fc.sample(declaration, { seed: 13, numRuns: 150 });
  const body = [
    ...calls.flatMap((c) => callLines(2, c.prefix, c.fn, c.args)),
    ...assigns.flatMap((a) => assignLines(2, a.lhs, a.value)),
  ];
  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract Probe {
${declarations.flatMap((d) => declarationLines(1, d.decl, d.value)).join("\n")}

    function f() internal {
${body.join("\n")}
    }
}
`;
}

describe.skipIf(!ENABLED)("generated scripts under forge", () => {
  let dir = "";
  const cases: Case[] = [];
  let build = { code: -1, out: "" };
  let fmt = { code: -1, out: "" };
  let probe = { code: -1, out: "" };
  let tests: Record<string, { status: string; reason?: string | null }> = {};
  const catalog = fixtureCatalog();

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "c7a-forge-"));
    for (const sub of ["script", "test", "lib", "probe"]) mkdirSync(join(dir, sub));
    symlinkSync(join(LATTICE ?? "", "lib/forge-std"), join(dir, "lib/forge-std"));
    writeFileSync(
      join(dir, "foundry.toml"),
      `[profile.default]\nsrc = "script"\ntest = "test"\nout = "out"\nlibs = ["lib"]\nsolc_version = "${catalog.toolchain.solc}"\noffline = true\nremappings = ["forge-std/=lib/forge-std/src/"]\n`,
    );
    const creation = proxyCode();
    // Every v1 recipe on both paths, plus a hostile project and vault name, plus an init with every ABI shape.
    const runs: { name: string; path: "factory" | "createx"; title: string; variant?: "hostile" | "sink" }[] = [
      ...v1Recipes(catalog).flatMap((name) => (["factory", "createx"] as const).map((path) => ({ name, path, title: `${name} ${path}` }))),
      { name: "GovernedVault", path: "factory", title: HOSTILE_NAME, variant: "hostile" },
      { name: "ERC20", path: "createx", title: "Kitchen sink", variant: "sink" },
    ];
    for (const { name, path, title, variant } of runs) {
      const scope = path === "factory" ? "every-chain" : "this-chain";
      let fixture = fixtureProject(catalog, name, { path, scope });
      fixture.project.name = title;
      if (variant === "hostile" && fixture.project.recipe.init.kind === "bundle") {
        const p = fixture.project.recipe.init.args["p"] as Record<string, string>;
        p["name"] = HOSTILE_NAME;
        fixture.analysis = analyze(fixture.project.recipe, catalog, { known: [], unconfirmed: [] });
      }
      if (variant === "sink") fixture = kitchenSink(fixture);
      const out = exportFoundry({ ...fixture, studioVersion: "0.0.0-test", chainIds: CHAINS, ...(path === "createx" ? { proxyCreationCode: creation } : {}) });
      if (!out.ok) throw new Error(`${title}: ${out.error}`);
      const contract = out.value.filename.replace(/\.s\.sol$/, "");
      const item: Case = { key: title, fixture, text: out.value.text, contract, path, ...(path === "createx" ? { creation } : {}) };
      cases.push(item);
      writeFileSync(join(dir, "script", out.value.filename), out.value.text);
      writeFileSync(join(dir, "test", `${contract}.t.sol`), harness(item, fixture.catalog));
    }
    const hostile = [...HOSTILE, ...fc.sample(fc.string({ unit: "binary", maxLength: 24 }), { seed: 3, numRuns: 40 })];
    writeFileSync(join(dir, "test", "Escape.t.sol"), escapeContract(hostile));
    writeFileSync(join(dir, "probe", "Probe.sol"), fmtProbe());
    fmt = run(dir, ["fmt", "--check", "script"]);
    probe = run(dir, ["fmt", "--check", "probe"]);
    build = run(dir, ["build"]);
    const result = run(dir, ["test", "--json", "--offline"]);
    const json = result.out.slice(result.out.indexOf("{"));
    try {
      const suites = JSON.parse(json) as Record<string, { test_results: Record<string, { status: string; reason?: string | null }> }>;
      for (const [suite, value] of Object.entries(suites)) {
        for (const [name, res] of Object.entries(value.test_results)) tests[`${suite.split(":")[1]}.${name.replace(/\(\)$/, "")}`] = res;
      }
    } catch {
      tests = { parse: { status: "Failure", reason: result.out.slice(0, 2000) } };
    }
  }, 300_000);

  afterAll(() => {
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
  });

  test("every v1 recipe's script compiles with forge-std on the pinned solc", () => {
    expect(cases.length).toBe(v1Recipes(catalog).length * 2 + 2);
    expect(build.out).not.toContain("Error");
    expect(build.code).toBe(0);
  });

  test("every script is forge fmt clean", () => {
    expect(fmt.out).toBe("");
    expect(fmt.code).toBe(0);
  });

  test("callLines and assignLines match forge fmt for every shape", () => {
    expect(probe.out).toBe("");
    expect(probe.code).toBe(0);
  });

  test("the forge harnesses pass: init, salt, deploy call and every refusal", () => {
    const failures = Object.entries(tests).filter(([, res]) => res.status !== "Success");
    expect(failures).toEqual([]);
    const names = Object.keys(tests);
    for (const item of cases) {
      const common = [
        "test_initEqualsEncodeInit", "test_saltEqualsBuildSalt", "test_unsupportedChain", "test_missingSharedContracts",
        "test_unexpectedCode", "test_predictMatches", "test_predictionDiffers", "test_deployCallMatches",
        "test_facetsMatchAsSets", "test_facetsDiffer", "test_unexpectedFacet", "test_selectorsDiffer",
      ];
      const own =
        item.path === "factory"
          ? ["test_addressTaken", "test_runSendsTheDeployCall", "test_runRefusesOtherSelectors", "test_runRefusesAnotherPrediction"]
          : ["test_createxWithOtherCode"];
      for (const t of [...common, ...own]) {
        expect(names).toContain(`${item.contract}Test.${t}`);
      }
    }
    expect(names.filter((n) => n.startsWith("EscapeTest.")).length).toBe(HOSTILE.length + 40);
  });

  test("the fixture's invented runtimes hash to the catalog's codehashes, so the happy path is real", () => {
    for (const item of cases) {
      for (const s of sharedOf(item.fixture, item.path)) expect([s.name, keccak256(fixtureRuntime(s.name))]).toEqual([s.name, s.codehash]);
    }
  });
});
