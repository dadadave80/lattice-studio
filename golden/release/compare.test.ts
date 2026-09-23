import { describe, expect, test } from "bun:test";
import { ARACHNID_PROXY, ARACHNID_PROXY_CODEHASH, type Address, type Hex, arachnidAddress, sharedSalt } from "@lattice-studio/core";
import { keccak256, stringToHex } from "viem";
import {
  type CatalogRelease,
  type Comparison,
  DEFAULT_REGISTRY_OWNER,
  type DeployerModel,
  type ReleaseReport,
  type SharedRelease,
  SKIP_REASON,
  addressUnder,
  compareRelease,
  createxRawAddress,
  detectDeployer,
  expectedFromCatalog,
  failed,
  formatComparison,
  knownGapNames,
  libraryCodehashAt,
  libraryProbes,
  libraryWindows,
  parseReleaseLogs,
} from "./compare.ts";

const VERSION = "0.2.0";
const OWNER: Address = "0x000000000000000000000000000000000000dEaD";
const hash = (label: string): Hex => keccak256(stringToHex(label));

/** A synthetic shared contract: its salt as DeployRelease derives it, a made-up init code and codehash. */
function shared(name: string, extra: Partial<SharedRelease> = {}): SharedRelease {
  const salt = sharedSalt(name, VERSION);
  const initCodeHash = extra.initCodeHash ?? hash(`init:${name}`);
  return { salt, version: VERSION, initCodeHash, address: arachnidAddress(salt, initCodeHash), codehash: hash(`code:${name}`), ...extra };
}

/** Studio's PoseidonT3 (the catalog links it) and the one forge linked at the pin. */
const POSEIDON_CATALOG = shared("PoseidonT3").address;
const POSEIDON_FORGE: Address = "0x792B818F95dD1cb390C09d0F483e774471C2FBF1";

/** Creation code that links `lib` twice (PUSH20 <lib> ... PUSH20 <lib>), like a contract calling a library. */
function linkedCode(lib: Address, middle = "5af450"): Hex {
  const at = lib.slice(2).toLowerCase();
  return `0x608060405273${at}${middle}73${at}5af400` as Hex;
}
const SEMAPHORE_CODE = linkedCode(POSEIDON_CATALOG);

/** A library's runtime deployed at `at`: its call guard PUSH20 <at>, ADDRESS, EQ, then its body. */
const libRuntime = (at: Address, body = "6080604052600080fd"): Hex => `0x73${at.slice(2).toLowerCase()}3014${body}` as Hex;
/** Studio's PoseidonT3 codehash: the library's runtime at the catalog's address. */
const POSEIDON_CODEHASH = keccak256(libRuntime(POSEIDON_CATALOG));

/** A small catalog: registry, factory, three facets, one of them linking an unpinned library. */
function catalog(): CatalogRelease {
  return {
    deployer: { address: ARACHNID_PROXY, codehash: ARACHNID_PROXY_CODEHASH },
    registryOwner: OWNER,
    registry: shared("LatticeRegistry"),
    factory: shared("LatticeFactory"),
    facets: [
      { name: "ERC20", release: shared("ERC20") },
      { name: "DiamondLoupeFacet", release: shared("DiamondLoupeFacet") },
      {
        name: "Semaphore",
        release: shared("Semaphore", { initCodeHash: keccak256(SEMAPHORE_CODE), dependsOn: ["PoseidonT3"], provisional: "Links PoseidonT3." }),
      },
    ],
    libraries: [
      { name: "PoseidonT3", release: shared("PoseidonT3", { codehash: POSEIDON_CODEHASH, provisional: "Lattice doesn't release PoseidonT3." }) },
    ],
  };
}

const withCode = () => expectedFromCatalog(catalog(), new Map([["Semaphore", SEMAPHORE_CODE]]));

/** What DeployRelease would report if it deployed the catalog exactly, under `model`. */
function faithfulReport(model: DeployerModel, c: CatalogRelease = catalog()): ReleaseReport {
  const all = [
    ["LatticeRegistry", c.registry],
    ["LatticeFactory", c.factory],
    ...c.facets.map((f) => [f.name, f.release] as const),
  ] as const;
  return {
    version: VERSION,
    owner: OWNER,
    deployerCodehash: ARACHNID_PROXY_CODEHASH,
    createx: model === "createx-raw" ? "mock-createx" : "no-createx",
    contracts: all.map(([name, s]) => ({ name, address: addressUnder(model, s.salt, s.initCodeHash), codehash: s.codehash })),
    creationCodes: {},
    libraries: {},
  };
}

function withContract(report: ReleaseReport, name: string, change: Partial<ReleaseReport["contracts"][number]>): ReleaseReport {
  return { ...report, contracts: report.contracts.map((c) => (c.name === name ? { ...c, ...change } : c)) };
}

type GapOptions = {
  /** Where DeployRelease put Semaphore; default where `forgeCode` lands. */
  at?: Address;
  /** Log forge's creation code (default true). */
  log?: boolean;
  /** The library the harness reports; default forge's PoseidonT3 with the catalog library's body; null for none. */
  library?: { address: Address; runtimeCode: Hex } | null;
};

/**
 * The release as forge produced it: Semaphore built from `forgeCode` (default: the catalog's code linking forge's
 * PoseidonT3) and deployed where that code lands, its creation code logged, and forge's PoseidonT3 reported.
 */
function gapReport(model: DeployerModel, forgeCode: Hex = linkedCode(POSEIDON_FORGE), opts: GapOptions = {}): ReleaseReport {
  const salt = sharedSalt("Semaphore", VERSION);
  const report = withContract(faithfulReport(model), "Semaphore", {
    address: opts.at ?? addressUnder(model, salt, keccak256(forgeCode)),
    codehash: hash("forge-linked runtime"),
  });
  const library = opts.library === undefined ? { address: POSEIDON_FORGE, runtimeCode: libRuntime(POSEIDON_FORGE) } : opts.library;
  return {
    ...report,
    creationCodes: opts.log === false ? {} : { Semaphore: forgeCode },
    libraries: library === null ? {} : { PoseidonT3: library },
  };
}

const statusOf = (c: Comparison, name: string) => c.rows.find((r) => r.name === name)?.status;
const detailOf = (c: Comparison, name: string) => c.rows.find((r) => r.name === name)?.detail ?? "";

describe("SKIP_REASON", () => {
  test("is the brief's wording", () => {
    expect(SKIP_REASON).toBe("Lattice A1 (release through Arachnid's proxy) isn't at the pin");
  });
});

describe("createxRawAddress", () => {
  // The catalog's LatticeRegistry at dev f4a32c8 (owner 0x…dEaD): its salt and init-code hash from
  // catalog/dev-f4a32c8/index.json. The CreateX address is the one forge reported: this suite's harness logged
  // `STUDIO_RELEASE contract LatticeRegistry 0x303aabD5fD0AF342095DA749b62aE651c1c9be79 …` after DeployRelease
  // deployed through MockCreateX at that pin (2026-09-23). It's copied from forge's output, not computed with viem.
  const salt: Hex = "0xc78231000c48b308a55c9ed0de492d4ee766bc920c611d52ef984a4d9baa3a9c";
  const initCodeHash: Hex = "0xf7efc65848d4b86379f7b2c82cc1738b823f21adc67589b9ab3dc1b8821c63ab";

  test("matches where DeployRelease put the registry through CreateX at the pin", () => {
    expect(createxRawAddress(salt, initCodeHash)).toBe("0x303aabD5fD0AF342095DA749b62aE651c1c9be79");
  });

  test("differs from Arachnid's proxy (the catalog's address) for the same salt and init code", () => {
    expect(arachnidAddress(salt, initCodeHash)).toBe("0x1fFbaCbec0F47e91E80Af6F54B7163dBf23CB7AF");
    expect(salt).toBe(sharedSalt("LatticeRegistry", VERSION));
  });
});

describe("detectDeployer", () => {
  const registry = shared("LatticeRegistry");
  test("names Arachnid's proxy, CreateX raw salts, or neither", () => {
    expect(detectDeployer(registry, arachnidAddress(registry.salt, registry.initCodeHash))).toBe("arachnid");
    expect(detectDeployer(registry, createxRawAddress(registry.salt, registry.initCodeHash))).toBe("createx-raw");
    expect(detectDeployer(registry, "0x0000000000000000000000000000000000000001")).toBe("unknown");
  });

  test("reads lowercase addresses too", () => {
    const at = createxRawAddress(registry.salt, registry.initCodeHash).toLowerCase() as Address;
    expect(detectDeployer(registry, at)).toBe("createx-raw");
  });
});

describe("parseReleaseLogs", () => {
  const header = `STUDIO_RELEASE header 0.2.0 ${OWNER} ${ARACHNID_PROXY_CODEHASH} mock-createx`;
  const line = (name: string, address: string, codehash: string) => `STUDIO_RELEASE contract ${name} ${address} ${codehash}`;
  const reg = line("LatticeRegistry", "0x303aabd5fd0af342095da749b62ae651c1c9be79", hash("r"));
  const code = `STUDIO_RELEASE code Semaphore ${SEMAPHORE_CODE.toUpperCase().replace("0X", "0x")}`;

  const lib = `STUDIO_RELEASE library PoseidonT3 ${POSEIDON_FORGE.toLowerCase()} ${libRuntime(POSEIDON_FORGE)}`;

  test("reads the header, contracts, creation code and libraries, ignoring what release() prints itself", () => {
    const parsed = parseReleaseLogs(["LatticeRegistry deployed: 0x303a…", header, reg, code, lib, "Facets deployed: 100 | skipped (already deployed): 0"]);
    expect(parsed).toEqual({
      ok: true,
      value: {
        version: "0.2.0",
        owner: OWNER,
        deployerCodehash: ARACHNID_PROXY_CODEHASH,
        createx: "mock-createx",
        contracts: [{ name: "LatticeRegistry", address: "0x303aabD5fD0AF342095DA749b62aE651c1c9be79", codehash: hash("r") }],
        creationCodes: { Semaphore: SEMAPHORE_CODE },
        libraries: { PoseidonT3: { address: POSEIDON_FORGE, runtimeCode: libRuntime(POSEIDON_FORGE) } },
      },
    });
  });

  test("reads a library address with no code", () => {
    const parsed = parseReleaseLogs([header, reg, `STUDIO_RELEASE library PoseidonT3 ${POSEIDON_FORGE} 0x`]);
    expect(parsed.ok && parsed.value.libraries).toEqual({ PoseidonT3: { address: POSEIDON_FORGE, runtimeCode: "0x" } });
  });

  const long = `STUDIO_RELEASE code Semaphore 0x${"ab".repeat(200)}z`;
  test.each([
    ["no header", ["Facets deployed: 100"], "the harness logged no header."],
    ["no contracts", [header], "the harness reported no contracts."],
    ["two headers", [header, header, reg], "the harness logged two headers."],
    ["a duplicate contract", [header, reg, reg], "the harness reported LatticeRegistry twice."],
    ["a contract before the header", [reg, header], `a contract line came before the header: "${reg}".`],
    ["a bad address", [header, line("ERC20", "0x1234", hash("e"))], `malformed contract line "${line("ERC20", "0x1234", hash("e"))}".`],
    ["a short codehash", [header, line("ERC20", OWNER, "0xabcd")], `malformed contract line "${line("ERC20", OWNER, "0xabcd")}".`],
    [
      "a header missing the CreateX field",
      [`STUDIO_RELEASE header 0.2.0 ${OWNER} ${ARACHNID_PROXY_CODEHASH}`],
      `malformed header line "STUDIO_RELEASE header 0.2.0 ${OWNER} ${ARACHNID_PROXY_CODEHASH}".`,
    ],
    ["a duplicate code line", [header, reg, code, code], "the harness logged Semaphore's creation code twice."],
    ["a duplicate library line", [header, reg, lib, lib], "the harness reported PoseidonT3 twice."],
    ["a library line with a bad address", [header, reg, "STUDIO_RELEASE library PoseidonT3 0x12 0x"], `malformed library line "STUDIO_RELEASE library PoseidonT3 0x12 0x".`],
    ["code that isn't hex, shortened", [header, reg, long], `malformed code line "${long.slice(0, 237)}...".`],
    ["an unknown kind", [header, "STUDIO_RELEASE facet ERC20"], `unknown line "STUDIO_RELEASE facet ERC20".`],
  ])("rejects %s", (_label, lines, error) => {
    expect(parseReleaseLogs(lines)).toEqual({ ok: false, error });
  });
});

describe("libraryWindows", () => {
  test("finds the address only as a PUSH20 operand, at byte offsets", () => {
    expect(libraryWindows(SEMAPHORE_CODE, POSEIDON_CATALOG)).toEqual([6, 30]);
    const bare = `0x6080604052${POSEIDON_CATALOG.slice(2)}00` as Hex;
    expect(libraryWindows(bare, POSEIDON_CATALOG)).toEqual([]);
  });
});

describe("libraryCodehashAt", () => {
  test("moves a library's call guard to another address", () => {
    expect(libraryCodehashAt(libRuntime(POSEIDON_FORGE), POSEIDON_FORGE, POSEIDON_CATALOG)).toEqual({ ok: true, value: POSEIDON_CODEHASH });
  });

  test("refuses code without the guard for its own address", () => {
    expect(libraryCodehashAt(libRuntime(POSEIDON_CATALOG), POSEIDON_FORGE, POSEIDON_CATALOG).ok).toBe(false);
  });
});

describe("expectedFromCatalog", () => {
  test("lists the registry, the factory, then the facets in catalog order", () => {
    expect(expectedFromCatalog(catalog()).contracts.map((c) => c.name)).toEqual([
      "LatticeRegistry",
      "LatticeFactory",
      "ERC20",
      "DiamondLoupeFacet",
      "Semaphore",
    ]);
  });

  test("marks a contract linking an unpinned library as a known gap, with the library's catalog address", () => {
    const expected = withCode();
    expect(knownGapNames(expected)).toEqual(["Semaphore"]);
    expect(expected.contracts.find((c) => c.name === "Semaphore")?.knownGap).toEqual({
      libraries: [{ name: "PoseidonT3", address: POSEIDON_CATALOG, codehash: POSEIDON_CODEHASH }],
      creationCode: SEMAPHORE_CODE,
    });
  });

  test("probes each unpinned library at the first PUSH20 window of a gap contract's catalog code", () => {
    expect(libraryProbes(withCode())).toEqual(["PoseidonT3:Semaphore:6"]);
    expect(libraryProbes(expectedFromCatalog(catalog()))).toEqual([]);
  });

  test("a dependency that isn't a provisional library isn't a known gap", () => {
    const c = catalog();
    c.libraries = [{ name: "PoseidonT3", release: shared("PoseidonT3") }];
    expect(knownGapNames(expectedFromCatalog(c))).toEqual([]);
  });

  test("falls back to the D6 placeholder owner", () => {
    const { registryOwner: _, ...rest } = catalog();
    expect(expectedFromCatalog(rest).registryOwner).toBe(DEFAULT_REGISTRY_OWNER);
  });
});

describe("compareRelease after Lattice A1 (Arachnid's proxy)", () => {
  const expected = withCode();

  test("passes when every contract is at the catalog's address with its codehash", () => {
    const c = compareRelease(expected, faithfulReport("arachnid"), "arachnid");
    expect(failed(c)).toBe(false);
    expect(c.problems).toEqual([]);
    expect(c.rows.every((r) => r.status === "match")).toBe(true);
    expect(formatComparison(c)).toEqual(["5 of 5 shared contracts are at the catalog's addresses."]);
  });

  test("names a facet at another address", () => {
    const moved = withContract(faithfulReport("arachnid"), "ERC20", { address: "0x0000000000000000000000000000000000000Bad" });
    const c = compareRelease(expected, moved, "arachnid");
    expect(failed(c)).toBe(true);
    expect(statusOf(c, "ERC20")).toBe("mismatch");
    const erc20 = expected.contracts.find((e) => e.name === "ERC20");
    expect(formatComparison(c)).toEqual([
      "4 of 5 shared contracts are at the catalog's addresses.",
      `  ERC20: differs: address ${erc20?.address} → 0x0000000000000000000000000000000000000Bad`,
    ]);
  });

  test("names a codehash difference at the right address", () => {
    const c = compareRelease(expected, withContract(faithfulReport("arachnid"), "LatticeFactory", { codehash: hash("other") }), "arachnid");
    expect(failed(c)).toBe(true);
    expect(c.rows.find((r) => r.name === "LatticeFactory")).toEqual({
      name: "LatticeFactory",
      status: "mismatch",
      detail: `codehash ${hash("code:LatticeFactory")} → ${hash("other")}`,
    });
  });

  test("accepts a divergence caused only by forge linking its own PoseidonT3 as a known Lattice gap", () => {
    const c = compareRelease(expected, gapReport("arachnid"), "arachnid");
    expect(failed(c)).toBe(false);
    expect(statusOf(c, "Semaphore")).toBe("known-gap");
    const lines = formatComparison(c);
    expect(lines[0]).toBe("4 of 5 shared contracts are at the catalog's addresses.");
    expect(lines[1]).toStartWith("  Semaphore: known Lattice gap: address ");
    expect(lines[1]).toEndWith(
      `; forge links PoseidonT3 at ${POSEIDON_FORGE} instead of ${POSEIDON_CATALOG}, which Lattice doesn't pin yet; the library and the creation code are otherwise the catalog's`,
    );
  });

  test("a known-gap contract that matches is just a match", () => {
    expect(statusOf(compareRelease(expected, faithfulReport("arachnid"), "arachnid"), "Semaphore")).toBe("match");
  });

  test("fails when a known-gap facet also drifts for another reason", () => {
    const drifted = linkedCode(POSEIDON_FORGE, "5af451");
    const c = compareRelease(expected, gapReport("arachnid", drifted), "arachnid");
    expect(failed(c)).toBe(true);
    expect(statusOf(c, "Semaphore")).toBe("mismatch");
    expect(detailOf(c, "Semaphore")).toEndWith(
      "; not only the unpinned library: forge's creation code differs from the catalog's at byte 28, outside the linked library addresses",
    );
    expect(formatComparison(c)[1]).toStartWith("  Semaphore: differs: address ");
  });

  test.each([
    ["forge's creation code isn't logged", () => gapReport("arachnid", undefined, { log: false }), withCode, "the harness didn't log forge's creation code, so the gap can't be checked"],
    ["the catalog's creation code isn't loaded", () => gapReport("arachnid"), () => expectedFromCatalog(catalog()), "the catalog's creation code wasn't loaded, so the gap can't be checked"],
    ["the lengths differ", () => gapReport("arachnid", `${linkedCode(POSEIDON_FORGE)}00` as Hex), withCode, "forge's creation code is 54 bytes, the catalog's 53"],
    [
      "one of forge's windows holds another address",
      () => gapReport("arachnid", `0x608060405273${POSEIDON_FORGE.slice(2).toLowerCase()}5af45073${"11".repeat(20)}5af400` as Hex),
      withCode,
      `forge's creation code doesn't link PoseidonT3 at ${POSEIDON_FORGE} at byte 30`,
    ],
    [
      "forge consistently links a different library",
      () => {
        const other: Address = "0x1111111111111111111111111111111111111111";
        return gapReport("arachnid", linkedCode(other), { library: { address: other, runtimeCode: libRuntime(other, "6080604052600180fd") } });
      },
      withCode,
      "forge's PoseidonT3 at 0x1111111111111111111111111111111111111111 isn't the catalog's: at ",
    ],
    [
      "forge's linked address holds no code",
      () => gapReport("arachnid", undefined, { library: { address: POSEIDON_FORGE, runtimeCode: "0x" } }),
      withCode,
      `forge's PoseidonT3 at ${POSEIDON_FORGE} isn't a library: there's no code there`,
    ],
    [
      "the code there doesn't start with the library guard",
      () => gapReport("arachnid", undefined, { library: { address: POSEIDON_FORGE, runtimeCode: "0x6080604052" } }),
      withCode,
      `forge's PoseidonT3 at ${POSEIDON_FORGE} isn't a library: its code doesn't start with a library's PUSH20 of its own address`,
    ],
    [
      "the harness didn't report the library",
      () => gapReport("arachnid", undefined, { library: null }),
      withCode,
      "the harness didn't report which PoseidonT3 forge linked",
    ],
    [
      "forge links the catalog's own address",
      () =>
        withContract(gapReport("arachnid", SEMAPHORE_CODE, { library: { address: POSEIDON_CATALOG, runtimeCode: libRuntime(POSEIDON_CATALOG) } }), "Semaphore", {
          codehash: hash("something else"),
        }),
      withCode,
      `forge links the catalog's own PoseidonT3 address ${POSEIDON_CATALOG}, so the library doesn't explain the difference`,
    ],
    [
      "DeployRelease didn't deploy forge's code",
      () => gapReport("arachnid", undefined, { at: "0x0000000000000000000000000000000000000Bad" }),
      withCode,
      "DeployRelease put it at 0x0000000000000000000000000000000000000Bad, not where forge's creation code lands",
    ],
  ])("fails a known gap when %s", (_label, report, exp, reason) => {
    const c = compareRelease(exp(), report(), "arachnid");
    expect(failed(c)).toBe(true);
    expect(statusOf(c, "Semaphore")).toBe("mismatch");
    expect(detailOf(c, "Semaphore")).toContain(`; not only the unpinned library: ${reason}`);
  });

  test("fails a known gap when the catalog's code doesn't hash to its init-code hash, or doesn't link the library", () => {
    const wrongHash = expectedFromCatalog(catalog(), new Map([["Semaphore", linkedCode(POSEIDON_CATALOG, "5af451")]]));
    expect(detailOf(compareRelease(wrongHash, gapReport("arachnid"), "arachnid"), "Semaphore")).toContain(
      "the catalog's creation code hashes to ",
    );

    const unlinked: Hex = `0x608060405273${"22".repeat(20)}5af45073${"22".repeat(20)}5af400`;
    const c = catalog();
    const semaphore = c.facets[2];
    if (semaphore) semaphore.release = shared("Semaphore", { initCodeHash: keccak256(unlinked), dependsOn: ["PoseidonT3"] });
    const result = compareRelease(expectedFromCatalog(c, new Map([["Semaphore", unlinked]])), gapReport("arachnid"), "arachnid");
    expect(detailOf(result, "Semaphore")).toContain(`the catalog's creation code doesn't link PoseidonT3 at ${POSEIDON_CATALOG}`);
  });

  test("fails on a contract the release didn't deploy, and on one the catalog lacks", () => {
    const report = faithfulReport("arachnid");
    report.contracts = report.contracts.filter((c) => c.name !== "DiamondLoupeFacet");
    report.contracts.push({ name: "NewFacet", address: "0x0000000000000000000000000000000000000001", codehash: hash("n") });
    const c = compareRelease(expected, report, "arachnid");
    expect(failed(c)).toBe(true);
    expect(statusOf(c, "DiamondLoupeFacet")).toBe("missing");
    expect(statusOf(c, "NewFacet")).toBe("extra");
    expect(formatComparison(c)).toEqual([
      "4 of 5 shared contracts are at the catalog's addresses.",
      "  DiamondLoupeFacet: missing: in the catalog, but DeployRelease didn't release it",
      "  NewFacet: extra: DeployRelease released it at 0x0000000000000000000000000000000000000001, but the catalog has no entry",
    ]);
  });

  test("fails when the version, the owner or the deployer's code differ", () => {
    const report = { ...faithfulReport("arachnid"), version: "0.3.0", owner: "0x0000000000000000000000000000000000000002" as Address };
    report.deployerCodehash = hash("not the proxy");
    const c = compareRelease(expected, report, "arachnid");
    expect(failed(c)).toBe(true);
    expect(c.problems).toEqual([
      "the catalog is for version 0.2.0; DeployRelease released 0.3.0.",
      `the catalog's registry owner is ${OWNER}; the harness passed 0x0000000000000000000000000000000000000002.`,
      `the code at Arachnid's proxy address has codehash ${hash("not the proxy")}; the catalog expects ${ARACHNID_PROXY_CODEHASH}.`,
    ]);
  });

  test("fails when the catalog's own address isn't CREATE2 of its salt and init-code hash", () => {
    const c = catalog();
    c.facets[0] = { name: "ERC20", release: { ...shared("ERC20"), initCodeHash: hash("drifted") } };
    const result = compareRelease(expectedFromCatalog(c), faithfulReport("arachnid"), "arachnid");
    expect(failed(result)).toBe(true);
    expect(result.problems[0]).toStartWith("the catalog's ERC20 address ");
  });
});

describe("compareRelease at the pin (CreateX raw salts)", () => {
  const expected = withCode();

  test("checks salts and init-code hashes through CreateX's formula and leaves the factory out", () => {
    const c = compareRelease(expected, faithfulReport("createx-raw"), "createx-raw");
    expect(failed(c)).toBe(false);
    expect(statusOf(c, "LatticeFactory")).toBe("not-compared");
    expect(formatComparison(c)).toEqual([
      "4 of 4 shared contracts are where the catalog's salts and init-code hashes put them through CreateX.",
      "  LatticeFactory: not compared: its init code holds the registry's address, which differs under CreateX",
    ]);
  });

  test("ignores the deployer's code, which DeployRelease doesn't use there", () => {
    const report = { ...faithfulReport("createx-raw"), deployerCodehash: hash("no proxy") };
    expect(compareRelease(expected, report, "createx-raw").problems).toEqual([]);
  });

  test("still fails when an init-code hash drifts", () => {
    const report = withContract(faithfulReport("createx-raw"), "ERC20", { address: "0x0000000000000000000000000000000000000Bad" });
    const c = compareRelease(expected, report, "createx-raw");
    expect(failed(c)).toBe(true);
    expect(statusOf(c, "ERC20")).toBe("mismatch");
  });

  test("checks known gaps through CreateX's formula too", () => {
    expect(statusOf(compareRelease(expected, gapReport("createx-raw"), "createx-raw"), "Semaphore")).toBe("known-gap");
    const drifted = compareRelease(expected, gapReport("createx-raw", linkedCode(POSEIDON_FORGE, "5af451")), "createx-raw");
    expect(failed(drifted)).toBe(true);
    expect(statusOf(drifted, "Semaphore")).toBe("mismatch");
  });

  test("an Arachnid-shaped report read as CreateX doesn't pass", () => {
    expect(failed(compareRelease(expected, faithfulReport("arachnid"), "createx-raw"))).toBe(true);
  });
});
