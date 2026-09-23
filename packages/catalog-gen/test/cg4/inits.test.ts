/**
 * The init walk and the overlay merge on hand-built ASTs: no Lattice build needed. The real-build test checks the
 * same code against the pinned Lattice.
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalType,
  DIAMOND_LIB_INITS,
  type InitSkeleton,
  initFactsFor,
  mergeInitOverlay,
  readInits,
  statelessInitContracts,
  supplementaryBuildCommand,
  withKey,
} from "../../src/inits";
import { artifactOf, File, loaderOf } from "./ast";

// ── a small two-library world ──────────────────────────────────────────────────────────────────────

const DIAMOND_LIB_PATH = "lib/diamond-lib/src/libraries/DiamondLib.sol";
const OWNABLE_LIB_PATH = "lib/diamond-lib/src/libraries/OwnableLib.sol";

function diamondLib() {
  const f = new File(DIAMOND_LIB_PATH, "library DiamondLib {\n    function registerInterface() internal {}\n}\n", 9000);
  const registerInterface = f.fn({ name: "registerInterface", snippet: "function registerInterface() internal {}" });
  return f.unit([f.contract("DiamondLib", [registerInterface], "library")]);
}

function ownableLib() {
  const f = new File(OWNABLE_LIB_PATH, "library OwnableLib {\n    function initializeOwner(address newOwner) internal {}\n}\n", 9100);
  const initializeOwner = f.fn({
    name: "initializeOwner",
    snippet: "function initializeOwner(address newOwner) internal {}",
    params: [f.param("newOwner", "address")],
  });
  return f.unit([f.contract("OwnableLib", [initializeOwner], "library")]);
}

const BAR_SOURCE = `import {DiamondLib} from "lib/diamond-lib/src/libraries/DiamondLib.sol";
library BarLib {
    function __Bar_init(address admin_, string memory version, address owner) internal {
        DiamondLib.registerInterface();
    }
    function helper() internal {
        DiamondLib.registerInterface();
        __Baz_init();
    }
    function __Baz_init() internal {}
    function __Arr_init(address[] memory list_) internal {}
}
`;

function barLib() {
  const f = new File("src/BarLib.sol", BAR_SOURCE, 5000);
  const diamondLibId = 1;
  const reg = (nth: number) =>
    f.stmt(
      f.call(
        "DiamondLib.registerInterface()",
        f.member("DiamondLib.registerInterface", f.ident("DiamondLib", diamondLibId, 1 + nth), "registerInterface", "function ()", nth),
        [],
        nth,
      ),
    );
  const bar = f.fn({
    name: "__Bar_init",
    snippet: "function __Bar_init(address admin_, string memory version, address owner) internal {",
    params: [f.param("admin_", "address"), f.param("version", "string memory"), f.param("owner", "address")],
    statements: [reg(0)],
  });
  const baz = f.fn({ name: "__Baz_init", snippet: "function __Baz_init() internal {}" });
  const helper = f.fn({
    name: "helper",
    snippet: "function helper() internal {",
    statements: [reg(1), f.stmt(f.call("__Baz_init()", f.ident("__Baz_init", baz.id ?? 0), []))],
  });
  const arr = f.fn({
    name: "__Arr_init",
    snippet: "function __Arr_init(address[] memory list_) internal {}",
    params: [f.param("list_", "address[] memory")],
  });
  return f.unit([f.import(DIAMOND_LIB_PATH, ["DiamondLib"]), f.contract("BarLib", [bar, helper, baz, arr], "library")]);
}

const FOO_SOURCE = `import {BarLib} from "src/BarLib.sol";
import {DiamondLib} from "lib/diamond-lib/src/libraries/DiamondLib.sol";
import {OwnableLib} from "lib/diamond-lib/src/libraries/OwnableLib.sol";
/// @notice Params for foo — grouped.
struct P {
    address asset; // underlying token
    uint48 delay; // seconds before voting.
}
contract FooInit {
    address public immutable EP;
    constructor(address ep_) { EP = ep_; }
    function init(address admin_, P calldata p) external {
        address self = address(this);
        address[] memory list = new address[](2);
        list[0] = self;
        list[1] = address(0);
        BarLib.__Bar_init(admin_, "1", self);
        BarLib.__Arr_init(list);
        OwnableLib.initializeOwner(p.asset);
        DiamondLib.registerInterface();
        _own(EP);
    }
    function other() external {
        BarLib.helper();
    }
    function _own(address ep) private {
        BarLib.__Bar_init(ep, "2", ep);
    }
}
`;

function fooInit() {
  const f = new File("src/FooInit.sol", FOO_SOURCE, 100);
  const struct = {
    nodeType: "StructDefinition",
    id: f.id(),
    name: "P",
    documentation: { nodeType: "StructuredDocumentation", text: "@notice Params for foo — grouped." },
    members: [
      { nodeType: "VariableDeclaration", id: f.id(), name: "asset", src: f.src("address asset") },
      { nodeType: "VariableDeclaration", id: f.id(), name: "delay", src: f.src("uint48 delay") },
    ],
  };
  const ep = { ...f.param("EP", "address"), stateVariable: true, mutability: "immutable" };
  const epArg = f.param("ep_", "address");
  const ctor = f.fn({
    name: "",
    kind: "constructor",
    visibility: "public",
    snippet: "constructor(address ep_) { EP = ep_; }",
    params: [epArg],
    statements: [f.assign(f.ident("EP", ep.id ?? 0, 1), f.ident("ep_", epArg.id ?? 0, 1))],
  });

  // `_own(address ep)`: BarLib.__Bar_init(ep, "2", ep)
  const epParam = f.param("ep", "address", 1);
  const ownBar = f.call(
    'BarLib.__Bar_init(ep, "2", ep)',
    f.member("BarLib.__Bar_init", f.ident("BarLib", 1, 3), "__Bar_init", "function (address,string memory,address)", 1),
    [f.ident("ep", epParam.id ?? 0, 2), f.str("2"), f.ident("ep", epParam.id ?? 0, 3)],
  );
  const own = f.fn({
    name: "_own",
    visibility: "private",
    snippet: "function _own(address ep) private {",
    params: [epParam],
    statements: [f.stmt(ownBar)],
  });

  const admin = f.param("admin_", "address");
  const p = f.param("p", "struct P calldata", 0);
  const self = f.param("self", "address");
  const list = f.param("list", "address[] memory");
  const selfRef = (nth: number) => f.ident("self", self.id ?? 0, nth);
  const init = f.fn({
    name: "init",
    visibility: "external",
    selector: "11111111",
    snippet: "function init(address admin_, P calldata p) external {",
    params: [admin, p],
    statements: [
      f.local(self, f.conversion("address(this)")),
      f.local(list, f.call("new address[](2)", { nodeType: "NewExpression", id: f.id() }, [f.number("2", "2", 0)])),
      f.assign(f.index(f.ident("list", list.id ?? 0, 1), f.number("0", "0]", 0)), selfRef(1)),
      f.assign(f.index(f.ident("list", list.id ?? 0, 2), f.number("1", "1]", 0)), f.conversion("address(0)")),
      f.stmt(
        f.call(
          'BarLib.__Bar_init(admin_, "1", self)',
          f.member("BarLib.__Bar_init", f.ident("BarLib", 1, 1), "__Bar_init", "function (address,string memory,address)"),
          [f.ident("admin_", admin.id ?? 0, 1), f.str("1"), selfRef(2)],
        ),
      ),
      f.stmt(
        f.call(
          "BarLib.__Arr_init(list)",
          f.member("BarLib.__Arr_init", f.ident("BarLib", 1, 2), "__Arr_init", "function (address[] memory)"),
          [f.ident("list", list.id ?? 0, 3)],
        ),
      ),
      f.stmt(
        f.call(
          "OwnableLib.initializeOwner(p.asset)",
          f.member("OwnableLib.initializeOwner", f.ident("OwnableLib", 2, 1), "initializeOwner", "function (address)"),
          [f.member("p.asset", { ...f.ident("p", p.id ?? 0), src: `${f.src("p.asset").split(":")[0]}:1:0` }, "asset", "address")],
        ),
      ),
      f.stmt(
        f.call(
          "DiamondLib.registerInterface()",
          f.member("DiamondLib.registerInterface", f.ident("DiamondLib", 3, 2), "registerInterface"),
          [],
        ),
      ),
      f.stmt(f.call("_own(EP)", f.ident("_own", own.id ?? 0), [f.ident("EP", ep.id ?? 0, 2)])),
    ],
  });
  const other = f.fn({
    name: "other",
    visibility: "external",
    selector: "22222222",
    snippet: "function other() external {",
    statements: [f.stmt(f.call("BarLib.helper()", f.member("BarLib.helper", f.ident("BarLib", 1, 4), "helper"), []))],
  });
  const unit = f.unit([
    f.import("src/BarLib.sol", ["BarLib"]),
    f.import(DIAMOND_LIB_PATH, ["DiamondLib"]),
    f.import(OWNABLE_LIB_PATH, ["OwnableLib"]),
    struct,
    f.contract("FooInit", [ep, ctor, init, other, own]),
  ]);
  const artifact = artifactOf(
    "FooInit",
    "src/FooInit.sol",
    [
      { type: "constructor", stateMutability: "nonpayable", inputs: [{ name: "ep_", type: "address", internalType: "address" }] },
      {
        type: "function",
        name: "init",
        stateMutability: "nonpayable",
        outputs: [],
        inputs: [
          { name: "admin_", type: "address", internalType: "address" },
          {
            name: "p",
            type: "tuple",
            internalType: "struct P",
            components: [
              { name: "asset", type: "address", internalType: "address" },
              { name: "delay", type: "uint48", internalType: "uint48" },
            ],
          },
        ],
      },
      { type: "function", name: "other", stateMutability: "nonpayable", inputs: [], outputs: [] },
      { type: "function", name: "EP", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
    ],
    { "init(address,(address,uint48))": "0x11111111", "other()": "0x22222222", "EP()": "0x33333333" },
    { "init(address,(address,uint48))": { admin_: "The   admin\n     of the diamond." } },
  );
  return { unit, artifact };
}

async function foo() {
  const { unit, artifact } = fooInit();
  const load = loaderOf([unit, barLib(), diamondLib(), ownableLib()]);
  const r = await initFactsFor(artifact, unit, load);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

// ── the walk ───────────────────────────────────────────────────────────────────────────────────────

describe("initFactsFor", () => {
  test("a contract with several entry points yields one spec per entry point, named <Contract>.<fn>", async () => {
    const { facts, notes } = await foo();
    expect(facts.map((f) => f.spec.name)).toEqual(["FooInit.init", "FooInit.other"]);
    expect(facts.map((f) => f.spec.contract)).toEqual(["FooInit", "FooInit"]);
    expect(facts.map((f) => f.selector)).toEqual(["0x11111111", "0x22222222"]);
    expect(notes).toEqual([]);
  });

  test("fn is the canonical signature, tuples as (a,b); components carry the struct's field names and docs", async () => {
    const [init] = (await foo()).facts;
    expect(init?.spec.fn).toBe("init(address,(address,uint48))");
    expect(init?.spec.params).toEqual([
      { name: "admin_", type: "address", doc: "The admin of the diamond." },
      {
        name: "p",
        type: "tuple",
        doc: "Params for foo — grouped.",
        components: [
          { name: "asset", type: "address", doc: "Underlying token." },
          { name: "delay", type: "uint48", doc: "Seconds before voting." },
        ],
      },
    ]);
  });

  test("constructor arguments become ctorArgs, and an immutable set from one renders as that argument", async () => {
    const [init] = (await foo()).facts;
    expect(init?.spec.ctorArgs).toEqual([{ name: "ep_", type: "address" }]);
    expect(init?.spec.initializes.at(-1)).toEqual({ module: "Bar", with: { admin: "ep_", version: "2", owner: "ep_" } });
  });

  test("initializes lists every __X_init in call order, through private helpers, with folded arguments", async () => {
    const [init] = (await foo()).facts;
    expect(init?.spec.initializes).toEqual([
      // `self` folds to its value; the string literal loses its quotes; `admin_` keeps its name.
      { module: "Bar", with: { admin: "admin_", version: "1", owner: "address(this)" } },
      // A fixed-size memory array filled index by index renders as a list.
      { module: "Arr", with: { list: "[address(this), address(0)]" } },
      // diamond-lib's Ownable has no __Ownable_init; initializeOwner is its init.
      { module: "Ownable", with: { owner: "p.asset" } },
      { module: "Bar", with: { admin: "ep_", version: "2", owner: "ep_" } },
    ]);
  });

  test("registersInterfaces: the init's own DiamondLib.registerInterface() counts, one inside a library doesn't", async () => {
    const [init, other] = (await foo()).facts;
    expect(init?.spec.registersInterfaces).toBe(true);
    // `other` reaches DiamondLib.registerInterface() only inside BarLib.helper, and runs __Baz_init there.
    expect(other?.spec.registersInterfaces).toBeUndefined();
    expect(other?.spec.initializes).toEqual([{ module: "Baz" }]);
  });

  test("the skeleton is a step with no order constraints until the overlay says otherwise", async () => {
    const [init] = (await foo()).facts;
    expect(init?.spec.kind).toBe("step");
    expect(init?.spec.after).toEqual([]);
    expect(init?.spec.sameCall).toEqual([]);
    expect(init?.source).toBe("src/FooInit.sol#L12-L12");
  });

  test("a single entry point takes the contract's name", async () => {
    const f = new File("src/SoloInit.sol", "contract SoloInit {\n    function init() external {}\n}\n", 7000);
    const unit = f.unit([
      f.contract("SoloInit", [f.fn({ name: "init", visibility: "external", selector: "e1c7392a", snippet: "function init() external {}" })]),
    ]);
    const artifact = artifactOf(
      "SoloInit",
      "src/SoloInit.sol",
      [{ type: "function", name: "init", stateMutability: "nonpayable", inputs: [], outputs: [] }],
      { "init()": "0xe1c7392a" },
    );
    const r = await initFactsFor(artifact, unit, loaderOf([unit]));
    if (!r.ok) throw new Error(r.error);
    expect(r.value.facts.map((x) => x.spec)).toEqual([
      { name: "SoloInit", contract: "SoloInit", fn: "init()", kind: "step", params: [], initializes: [], after: [], sameCall: [] },
    ]);
    expect(statelessInitContracts(r.value.facts).map((c) => c.contract)).toEqual(["SoloInit"]);
  });

  test("stateless contracts leave out inits with constructor arguments, once per contract", async () => {
    expect(statelessInitContracts((await foo()).facts)).toEqual([]);
  });
});

describe("helpers", () => {
  test("withKey strips leading and trailing underscores", () => {
    expect(["asset_", "_owner", "name", "__x__", "_"].map(withKey)).toEqual(["asset", "owner", "name", "x", "_"]);
  });

  test("canonicalType writes tuples and tuple arrays in signature form", () => {
    expect(canonicalType({ type: "address" })).toBe("address");
    expect(
      canonicalType({
        type: "tuple[]",
        components: [{ type: "uint8" }, { type: "tuple", components: [{ type: "string" }, { type: "bytes32[2]" }] }],
      }),
    ).toBe("(uint8,(string,bytes32[2]))[]");
  });

  test("the supplementary build compiles diamond-lib's three initializers in the checkout", () => {
    expect(supplementaryBuildCommand("/l")).toEqual(["forge", "build", "--root", "/l", ...DIAMOND_LIB_INITS]);
  });
});

describe("readInits", () => {
  test("refuses a build without the diamond-lib initializers, naming the command that adds them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cg4-"));
    try {
      await mkdir(join(dir, "src"), { recursive: true });
      await mkdir(join(dir, "out"), { recursive: true });
      // A file with no init contract needs no artifact; one that declares an init does.
      await writeFile(join(dir, "src", "Initializable.sol"), "abstract contract Initializable {}\n");
      await writeFile(join(dir, "src", "FooInit.sol"), "contract FooInit {}\n");
      const r = await readInits(dir);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error).toContain(`no artifacts for src/FooInit.sol, ${DIAMOND_LIB_INITS.join(", ")}.`);
      expect(r.error).toContain(`FOUNDRY_PROFILE=ci forge build --root ${dir} ${DIAMOND_LIB_INITS.join(" ")}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── the overlay ────────────────────────────────────────────────────────────────────────────────────

function skeleton(over: Partial<InitSkeleton> = {}): InitSkeleton {
  return {
    name: "VaultInit",
    contract: "VaultInit",
    fn: "init(address,(uint32,uint256))",
    kind: "step",
    params: [
      { name: "admin", type: "address", doc: "The admin." },
      {
        name: "p",
        type: "tuple",
        doc: "",
        components: [
          { name: "period", type: "uint32", doc: "Vote length." },
          { name: "quorum", type: "uint256", doc: "" },
        ],
      },
    ],
    initializes: [{ module: "AccessControl", with: { admin: "admin" } }, { module: "Vault" }],
    after: [],
    sameCall: [],
    ...over,
  };
}

describe("mergeInitOverlay", () => {
  test("the overlay supplies kind, units, rules, examples, authority, roles, docs, after, sameCall and sequence", () => {
    const merged = mergeInitOverlay([skeleton()], {
      VaultInit: {
        kind: "bundle",
        params: {
          admin: { rule: "nonzero", authority: true, role: "DEFAULT_ADMIN_ROLE" },
          p: {
            doc: "Vault parameters.",
            components: {
              period: { unit: "seconds", rule: "gt(0)", example: "600", exampleSource: "script/X.s.sol#L3-L3" },
              quorum: { unit: "percent", doc: "Quorum out of 100.", example: "4", exampleSource: "studio" },
            },
          },
        },
        after: ["ERC4626"],
        sameCall: ["ERC20"],
        sequence: ["AccessControl", "Vault"],
        registersInterfaces: false,
      },
    });
    expect(merged.inits).toEqual([
      {
        name: "VaultInit",
        contract: "VaultInit",
        fn: "init(address,(uint32,uint256))",
        kind: "bundle",
        params: [
          { name: "admin", type: "address", doc: "The admin.", rule: "nonzero", authority: true, role: "DEFAULT_ADMIN_ROLE" },
          {
            name: "p",
            type: "tuple",
            doc: "Vault parameters.",
            components: [
              { name: "period", type: "uint32", doc: "Vote length.", unit: "seconds", rule: "gt(0)", example: "600", exampleSource: "script/X.s.sol#L3-L3" },
              { name: "quorum", type: "uint256", doc: "Quorum out of 100.", unit: "percent", example: "4", exampleSource: "studio" },
            ],
          },
        ],
        initializes: [{ module: "AccessControl", with: { admin: "admin" } }, { module: "Vault" }],
        after: ["ERC4626"],
        sameCall: ["ERC20"],
        sequence: ["AccessControl", "Vault"],
      },
    ]);
    expect(merged.withoutOverlay).toEqual([]);
    expect(merged.conflicts).toEqual([]);
    expect(merged.undocumented).toEqual([]);
  });

  test("inits with no overlay entry are listed for the lint, and keep the source's facts", () => {
    const merged = mergeInitOverlay([skeleton(), skeleton({ name: "Other", contract: "Other" })], { Other: {} });
    expect(merged.withoutOverlay).toEqual(["VaultInit"]);
    expect(merged.inits[0]).toEqual(skeleton());
    expect(merged.undocumented).toEqual(["VaultInit.p", "VaultInit.p.quorum", "Other.p", "Other.p.quorum"]);
  });

  test("the source wins over the overlay on registersInterfaces and names; the conflict is reported", () => {
    const merged = mergeInitOverlay([skeleton({ registersInterfaces: true, ctorArgs: [{ name: "ep_", type: "address" }] })], {
      VaultInit: { registersInterfaces: false, params: { owner: { rule: "nonzero" }, p: { components: { votes: {} } } } },
      Gone: {},
    });
    expect(merged.inits[0]?.registersInterfaces).toBe(true);
    expect(merged.inits[0]?.ctorArgs).toEqual([{ name: "ep_", type: "address" }]);
    expect(merged.unknownOverlay).toEqual(["Gone"]);
    expect(merged.conflicts).toEqual([
      "VaultInit: the overlay names parameter owner, which init(address,(uint32,uint256)) doesn't take.",
      "VaultInit: the overlay says registersInterfaces false, the source says true; the source wins.",
      "VaultInit.p: the overlay names field votes, which the struct doesn't have.",
    ]);
  });
});
