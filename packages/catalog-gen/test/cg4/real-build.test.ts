/**
 * Integration: every init in the pinned Lattice, read from a ci build. Runs in a checkout this run owns (see
 * `realBuildGate`); skipped otherwise. The build is incremental: seconds when `out/` is current.
 *
 * The comparison with K3's fixture uses K3's hand overlay (`fixtures/gen/overlay.ts`) as the injected overlay,
 * standing in for CG5's loader, so what's compared is what the source states.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { InitSpecSchema } from "@lattice-studio/core";
import { INITS, type InitSource } from "../../../../fixtures/gen/overlay";
import { studioEnv } from "../../src/anvil";
import {
  buildSupplementaryInits,
  type InitFacts,
  type InitOverlay,
  type InitParamOverlay,
  type InitSkeleton,
  mergeInitOverlay,
  readInits,
  statelessInitContracts,
} from "../../src/inits";
import { realBuildGate } from "../cg1/real-build-gate";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const gate = realBuildGate((name) => studioEnv(name, REPO_ROOT), REPO_ROOT, (bin) => Bun.which(bin));
const LATTICE = gate.latticeDir;
const BUILD_TIMEOUT_MS = 20 * 60_000;

/** Contracts whose inits set the diamond's own ERC-165 flags at the pin (contracts §3.1). */
const REGISTERS_INTERFACES = [
  "AccountInit",
  "AccountInit6900",
  "DiamondIntrospectionInit",
  "GovernedDiamondCutInit",
  "GovernedSafeDiamondCutInit",
  "GovernedVaultENSInit",
  "GovernedVaultInit",
  "SafeDiamondCutInit",
];

/**
 * Docs where K3's fixture (hand-written) and the source differ; the overlay settles them (contracts §4). Each
 * entry: the fixture's text, what the source gives, and where the source says it.
 */
const DOC_DIFFERENCES: Record<string, { fixture: string; source: string; cite: string }> = {
  "MultiInit._initAddresses": {
    fixture: "The init contracts, delegatecalled in order.",
    source: "",
    cite: "lib/diamond-lib/src/initializers/MultiInit.sol#L15 (no NatSpec)",
  },
  "MultiInit._initData": {
    fixture: "The calldata for each init contract, index-aligned with the addresses.",
    source: "",
    cite: "lib/diamond-lib/src/initializers/MultiInit.sol#L15 (no NatSpec)",
  },
  "ERC20Init.name_": { fixture: "Token name.", source: "", cite: "src/tokens/ERC20/ERC20Init.sol#L13 (no @param)" },
  "ERC20Init.symbol_": { fixture: "Token symbol.", source: "", cite: "src/tokens/ERC20/ERC20Init.sol#L13 (no @param)" },
  "ERC20PermitInit.name_": {
    fixture: "The EIP-712 domain name: the token name.",
    source: "",
    cite: "src/tokens/ERC20/ERC20PermitInit.sol#L16 (no @param)",
  },
  "GovernedVaultInit.p": {
    fixture: "Governance parameters for the self-governed vault.",
    source: "Governance parameters for the self-governed vault (grouped to avoid stack-too-deep).",
    cite: "src/defi/GovernedVaultInit.sol#L19 (the struct's @notice)",
  },
  "GovernedVaultInit.p.name": {
    fixture: "Share-token name (also the EIP-712 domain name and governor name).",
    source: "Share-token name (also the EIP-712 domain name + governor name).",
    cite: "src/defi/GovernedVaultInit.sol#L22",
  },
  "GovernedVaultInit.p.minDelay": {
    fixture: "Timelock delay between queue and execute.",
    source: "Timelock delay (seconds) between queue and execute.",
    cite: "src/defi/GovernedVaultInit.sol#L25",
  },
  "GovernedVaultInit.p.votingDelay": {
    fixture: "Time between proposal creation and voting start.",
    source: "Clock units between proposal creation and voting start.",
    cite: "src/defi/GovernedVaultInit.sol#L26",
  },
  "GovernedVaultInit.p.votingPeriod": {
    fixture: "How long the vote stays open (must be > 0).",
    source: "Clock units the vote stays open (must be > 0).",
    cite: "src/defi/GovernedVaultInit.sol#L27",
  },
  "GovernedVaultInit.p.proposalThreshold": {
    fixture: "Minimum votes to create a proposal.",
    source: "Min votes to create a proposal.",
    cite: "src/defi/GovernedVaultInit.sol#L28",
  },
  "GovernedVaultInit.p.quorumNumerator": {
    fixture: "Quorum as a percentage of total supply.",
    source: "Quorum as numerator over QUORUM_DENOMINATOR.",
    cite: "src/defi/GovernedVaultInit.sol#L29",
  },
  "AccountInit6900.owner": {
    fixture: "The account's admin: the authority that installs and uninstalls validations and executions.",
    source: "The account's admin — the authority that installs/uninstalls validations and executions.",
    cite: "src/accounts/erc6900/AccountInit6900.sol#L36",
  },
};

type Param = InitSkeleton["params"][number];

function paramOverlay(p: Param, withDocs: boolean): InitParamOverlay {
  const o: InitParamOverlay = {};
  if (withDocs && p.doc !== undefined) o.doc = p.doc;
  if (p.unit !== undefined) o.unit = p.unit;
  if (p.rule !== undefined) o.rule = p.rule;
  if (p.example !== undefined) o.example = p.example;
  if (p.exampleSource !== undefined) o.exampleSource = p.exampleSource;
  if (p.authority !== undefined) o.authority = p.authority;
  if (p.role !== undefined) o.role = p.role;
  if (p.components) o.components = Object.fromEntries(p.components.map((c) => [c.name, paramOverlay(c, withDocs)]));
  return o;
}

/** K3's hand overlay in the shape `mergeInitOverlay` takes, keyed by the names at the pin. */
function k3Overlay(withDocs: boolean): Record<string, InitOverlay> {
  return Object.fromEntries(
    INITS.map((s: InitSource) => {
      const o: InitOverlay = {
        kind: s.kind,
        params: Object.fromEntries(s.params.map((p) => [p.name, paramOverlay(p, withDocs)])),
        after: s.after,
        sameCall: s.sameCall,
        registersInterfaces: s.registersInterfaces === true,
      };
      if (s.sequence) o.sequence = s.sequence;
      return [s.name, o];
    }),
  );
}

type FixtureInit = InitSkeleton & { release?: unknown; afterSource?: unknown };

async function fixtureInits(): Promise<InitSkeleton[]> {
  const index = (await Bun.file(join(REPO_ROOT, "fixtures", "catalog", "fixture", "index.json")).json()) as {
    inits: FixtureInit[];
  };
  return index.inits.map(({ release: _r, afterSource: _a, ...spec }) => spec);
}

function docs(params: Param[], prefix: string, out: Map<string, string>): Map<string, string> {
  for (const p of params) {
    out.set(`${prefix}.${p.name}`, p.doc ?? "");
    if (p.components) docs(p.components, `${prefix}.${p.name}`, out);
  }
  return out;
}

const title = "every init at the pin, from the ci build";
describe.skipIf(!gate.run)(gate.run ? title : `${title} (skipped: ${gate.reason})`, () => {
  let inits: InitFacts[] = [];
  let notes: string[] = [];
  let externalCalls: string[] = [];
  let fixture: InitSkeleton[] = [];

  beforeAll(async () => {
    const build = Bun.spawn(["forge", "build", "--root", LATTICE], {
      env: { ...process.env, FOUNDRY_PROFILE: "ci" },
      stdout: "ignore",
      stderr: "pipe",
    });
    if ((await build.exited) !== 0) throw new Error(`forge build failed:\n${await new Response(build.stderr).text()}`);
    const extra = await buildSupplementaryInits(LATTICE);
    if (!extra.ok) throw new Error(extra.error);
    const read = await readInits(LATTICE);
    if (!read.ok) throw new Error(read.error);
    ({ inits, notes, externalCalls } = read.value);
    fixture = await fixtureInits();
  }, BUILD_TIMEOUT_MS);

  test("89 init contracts give 90 specs, sorted by name; every internal call was followed", () => {
    expect(new Set(inits.map((f) => f.spec.contract)).size).toBe(89);
    expect(inits).toHaveLength(90);
    const names = inits.map((f) => f.spec.name);
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(90);
    expect(notes).toEqual([]);
    // Calls into other code, which aren't init code: pinned so a new one gets looked at.
    expect(externalCalls).toEqual([
      "lib/diamond-lib/src/initializers/MultiInit.sol#L25: initAddress.delegatecall",
      "src/defi/GovernedVaultENSInit.sol#L104: IReverseRegistrar(p.reverseRegistrar).setName",
      "src/governance/libraries/GovernedSafeDiamondCutLib.sol#L140: ISafe(_safe).getThreshold",
      "src/governance/libraries/SafeDiamondCutLib.sol#L129: ISafe(_safe).getThreshold",
      "src/tokens/ERC20/libraries/ERC20WrapperLib.sol#L65: underlying_.staticcall",
      "src/tokens/ERC4626/libraries/ERC4626Lib.sol#L81: asset_.staticcall",
    ]);
  });

  test("only DiamondIntrospectionInit is split per entry point; AccountInit.init7702() is left out", () => {
    const split = inits.filter((f) => f.spec.name !== f.spec.contract).map((f) => [f.spec.name, f.spec.fn]);
    expect(split).toEqual([
      ["DiamondIntrospectionInit.initImmutable", "initImmutable()"],
      ["DiamondIntrospectionInit.initUpgradeable", "initUpgradeable()"],
    ]);
  });

  test("AccountInit keeps its plain name: init7702() is EIP-7702-only (contracts §3.1)", () => {
    expect(inits.some((f) => f.spec.fn === "init7702()")).toBe(false);
    const account = inits.filter((f) => f.spec.contract === "AccountInit");
    expect(account.map((f) => [f.spec.name, f.spec.fn])).toEqual([["AccountInit", "init(address)"]]);
  });

  test("exactly eight contracts register the diamond's ERC-165 flags themselves", () => {
    const registering = [...new Set(inits.filter((f) => f.spec.registersInterfaces).map((f) => f.spec.contract))].sort();
    expect(registering).toEqual(REGISTERS_INTERFACES);
    // Both entry points of each multi-entry contract register.
    for (const f of inits.filter((x) => REGISTERS_INTERFACES.includes(x.spec.contract))) {
      expect(f.spec.registersInterfaces).toBe(true);
    }
    // A module init that registers its own interface id through its library doesn't count (contracts §3.1).
    const erc20 = inits.find((f) => f.spec.name === "ERC20Init");
    expect(erc20?.spec.initializes).toEqual([{ module: "ERC20", with: { name: "name_", symbol: "symbol_" } }]);
    expect(erc20?.spec.registersInterfaces).toBeUndefined();
  });

  test("OwnableInit is there: init(address), the one way to set the owner DiamondCutFacet checks", () => {
    const ownable = inits.find((f) => f.spec.name === "OwnableInit");
    expect(ownable?.sourcePath).toBe("lib/diamond-lib/src/initializers/OwnableInit.sol");
    expect(ownable?.selector).toBe("0x19ab453c");
    expect(ownable?.spec).toEqual({
      name: "OwnableInit",
      contract: "OwnableInit",
      fn: "init(address)",
      kind: "step",
      params: [{ name: "_owner", type: "address", doc: "The address to set as the contract owner." }],
      initializes: [{ module: "Ownable", with: { owner: "_owner" } }],
      after: [],
      sameCall: [],
    });
  });

  test("diamond-lib's MultiInit and ERC165Init are there, DiamondInit isn't", () => {
    const names = inits.map((f) => f.spec.name);
    expect(names).toContain("MultiInit");
    expect(names).toContain("ERC165Init");
    expect(names).not.toContain("DiamondInit");
    expect(inits.find((f) => f.spec.name === "ERC165Init")?.spec.initializes).toEqual([{ module: "ERC165" }]);
  });

  test("inits with constructor arguments carry ctorArgs and get no release; the rest are stateless", () => {
    expect(inits.filter((f) => f.spec.ctorArgs).map((f) => [f.spec.name, f.spec.ctorArgs])).toEqual([
      ["AccountInit", [{ name: "entryPoint_", type: "address" }]],
      ["AccountInit6900", [{ name: "entryPoint_", type: "address" }]],
    ]);
    const stateless = statelessInitContracts(inits).map((c) => c.contract);
    expect(stateless).toHaveLength(87);
    expect(stateless).not.toContain("AccountInit");
    expect(stateless).toContain("DiamondIntrospectionInit");
  });

  test("with K3's overlay, every fixture init equals the fixture's", () => {
    const merged = mergeInitOverlay(
      inits.map((f) => f.spec),
      k3Overlay(true),
    );
    expect(merged.conflicts).toEqual([]);
    expect(merged.unknownOverlay).toEqual([]);
    const byName = new Map(merged.inits.map((s) => [s.name, s]));
    for (const want of fixture) expect(byName.get(want.name)).toEqual(want);
    for (const s of merged.inits) expect(InitSpecSchema.safeParse(s).success).toBe(true);
    // Each place K3's docs replace a different, non-empty NatSpec doc reaches the lint.
    const replaced = Object.entries(DOC_DIFFERENCES)
      .filter(([, d]) => d.source !== "")
      .map(([path, d]) => ({ path, source: d.source, overlay: d.fixture }));
    const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : 1);
    expect([...merged.docOverrides].sort(byPath)).toEqual(replaced.sort(byPath));
    expect(merged.docOverrides).toHaveLength(8);
  });

  test("the source's own docs differ from the fixture's only where listed, each with its source line", () => {
    const merged = mergeInitOverlay(
      inits.map((f) => f.spec),
      k3Overlay(false),
    );
    const byName = new Map(merged.inits.map((s) => [s.name, s]));
    const differences: Record<string, { fixture: string; source: string }> = {};
    for (const want of fixture) {
      const got = byName.get(want.name);
      if (!got) throw new Error(`${want.name} is missing`);
      const source = docs(got.params, got.name, new Map());
      for (const [path, doc] of docs(want.params, want.name, new Map())) {
        if (source.get(path) !== doc) differences[path] = { fixture: doc, source: source.get(path) ?? "(missing)" };
      }
      // Everything but the docs is equal.
      const strip = (s: InitSkeleton) => JSON.stringify(s, (k, v) => (k === "doc" ? undefined : v));
      expect(strip(got)).toBe(strip(want));
    }
    const expected = Object.fromEntries(Object.entries(DOC_DIFFERENCES).map(([k, { fixture: f, source: s }]) => [k, { fixture: f, source: s }]));
    expect(differences).toEqual(expected);
  });

  test("inits with no overlay entry are listed for the lint", () => {
    const merged = mergeInitOverlay(
      inits.map((f) => f.spec),
      k3Overlay(true),
    );
    const covered = new Set(fixture.map((s) => s.name));
    expect(merged.withoutOverlay).toEqual(inits.map((f) => f.spec.name).filter((n) => !covered.has(n)));
    expect(merged.withoutOverlay).toHaveLength(73);
    expect(merged.withoutOverlay).not.toContain("AccountInit");
  });
});
