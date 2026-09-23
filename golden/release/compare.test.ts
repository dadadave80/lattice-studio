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
  parseReleaseLogs,
} from "./compare.ts";

const VERSION = "0.2.0";
const OWNER: Address = "0x000000000000000000000000000000000000dEaD";
const hash = (label: string): Hex => keccak256(stringToHex(label));

/** A synthetic shared contract: its salt as DeployRelease derives it, a made-up init code and codehash. */
function shared(name: string, extra: Partial<SharedRelease> = {}): SharedRelease {
  const salt = sharedSalt(name, VERSION);
  const initCodeHash = hash(`init:${name}`);
  return { salt, version: VERSION, initCodeHash, address: arachnidAddress(salt, initCodeHash), codehash: hash(`code:${name}`), ...extra };
}

const PROVISIONAL = "Links PoseidonT3, which Lattice doesn't pin yet.";

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
      { name: "Semaphore", release: shared("Semaphore", { dependsOn: ["PoseidonT3"], provisional: PROVISIONAL }) },
    ],
    libraries: [{ name: "PoseidonT3", release: shared("PoseidonT3", { provisional: "Lattice doesn't release PoseidonT3." }) }],
  };
}

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
    contracts: all.map(([name, s]) => ({ name, address: addressUnder(model, s.salt, s.initCodeHash), codehash: s.codehash })),
  };
}

function withContract(report: ReleaseReport, name: string, change: Partial<ReleaseReport["contracts"][number]>): ReleaseReport {
  return { ...report, contracts: report.contracts.map((c) => (c.name === name ? { ...c, ...change } : c)) };
}

const statusOf = (c: Comparison, name: string) => c.rows.find((r) => r.name === name)?.status;

describe("SKIP_REASON", () => {
  test("is the brief's wording", () => {
    expect(SKIP_REASON).toBe("Lattice A1 (release through Arachnid's proxy) isn't at the pin");
  });
});

describe("createxRawAddress", () => {
  // The catalog's LatticeRegistry at dev f4a32c8 (owner 0x…dEaD) and where DeployRelease put it through the
  // CreateX mock in a forge test at that pin, and where Arachnid's proxy puts it (the catalog's address).
  const salt: Hex = "0xc78231000c48b308a55c9ed0de492d4ee766bc920c611d52ef984a4d9baa3a9c";
  const initCodeHash: Hex = "0xf7efc65848d4b86379f7b2c82cc1738b823f21adc67589b9ab3dc1b8821c63ab";

  test("matches CreateXDeployer.predictRaw at the pin", () => {
    expect(createxRawAddress(salt, initCodeHash)).toBe("0x303aabD5fD0AF342095DA749b62aE651c1c9be79");
  });

  test("differs from Arachnid's proxy for the same salt and init code", () => {
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
  const header = `STUDIO_RELEASE header 0.2.0 ${OWNER} ${ARACHNID_PROXY_CODEHASH}`;
  const line = (name: string, address: string, codehash: string) => `STUDIO_RELEASE contract ${name} ${address} ${codehash}`;
  const reg = line("LatticeRegistry", "0x303aabd5fd0af342095da749b62ae651c1c9be79", hash("r"));

  test("reads the header and contracts, ignoring what release() prints itself", () => {
    const parsed = parseReleaseLogs(["LatticeRegistry deployed: 0x303a…", header, reg, "Facets deployed: 100 | skipped (already deployed): 0"]);
    expect(parsed).toEqual({
      ok: true,
      value: {
        version: "0.2.0",
        owner: OWNER,
        deployerCodehash: ARACHNID_PROXY_CODEHASH,
        contracts: [{ name: "LatticeRegistry", address: "0x303aabD5fD0AF342095DA749b62aE651c1c9be79", codehash: hash("r") }],
      },
    });
  });

  test.each([
    ["no header", ["Facets deployed: 100"], "the harness logged no header."],
    ["no contracts", [header], "the harness reported no contracts."],
    ["two headers", [header, header, reg], "the harness logged two headers."],
    ["a duplicate contract", [header, reg, reg], "the harness reported LatticeRegistry twice."],
    ["a contract before the header", [reg, header], `a contract line came before the header: "${reg}".`],
    ["a bad address", [header, line("ERC20", "0x1234", hash("e"))], `malformed contract line "${line("ERC20", "0x1234", hash("e"))}".`],
    ["a short codehash", [header, line("ERC20", OWNER, "0xabcd")], `malformed contract line "${line("ERC20", OWNER, "0xabcd")}".`],
    ["a header missing a field", ["STUDIO_RELEASE header 0.2.0 " + OWNER], `malformed header line "STUDIO_RELEASE header 0.2.0 ${OWNER}".`],
    ["an unknown kind", [header, "STUDIO_RELEASE facet ERC20"], `unknown line "STUDIO_RELEASE facet ERC20".`],
  ])("rejects %s", (_label, lines, error) => {
    expect(parseReleaseLogs(lines)).toEqual({ ok: false, error });
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

  test("marks a contract linking an unpinned library as a known Lattice gap, and nothing else", () => {
    const expected = expectedFromCatalog(catalog());
    const gaps = expected.contracts.filter((c) => c.knownGap !== undefined);
    expect(gaps.map((c) => c.name)).toEqual(["Semaphore"]);
    expect(gaps[0]?.knownGap).toBe("links PoseidonT3, which Lattice doesn't pin yet, so the catalog links Studio's own release of it");
  });

  test("a dependency that isn't a provisional library isn't a known gap", () => {
    const c = catalog();
    c.libraries = [{ name: "PoseidonT3", release: shared("PoseidonT3") }];
    expect(expectedFromCatalog(c).contracts.some((e) => e.knownGap !== undefined)).toBe(false);
  });

  test("falls back to the D6 placeholder owner", () => {
    const { registryOwner: _, ...rest } = catalog();
    expect(expectedFromCatalog(rest).registryOwner).toBe(DEFAULT_REGISTRY_OWNER);
  });
});

describe("compareRelease after Lattice A1 (Arachnid's proxy)", () => {
  const expected = expectedFromCatalog(catalog());

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

  test("reports a divergence on a contract linking an unpinned library as a known Lattice gap and still passes", () => {
    const report = withContract(faithfulReport("arachnid"), "Semaphore", {
      address: "0xfA211605A3b034aFfB4C93Ab89Ae39d99766efBd",
      codehash: hash("forge-linked"),
    });
    const c = compareRelease(expected, report, "arachnid");
    expect(failed(c)).toBe(false);
    expect(statusOf(c, "Semaphore")).toBe("known-gap");
    const lines = formatComparison(c);
    expect(lines[0]).toBe("4 of 5 shared contracts are at the catalog's addresses.");
    expect(lines[1]).toStartWith("  Semaphore: known Lattice gap: address ");
    expect(lines[1]).toEndWith("; links PoseidonT3, which Lattice doesn't pin yet, so the catalog links Studio's own release of it");
  });

  test("a known-gap contract that matches is just a match", () => {
    expect(statusOf(compareRelease(expected, faithfulReport("arachnid"), "arachnid"), "Semaphore")).toBe("match");
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
  const expected = expectedFromCatalog(catalog());

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

  test("an Arachnid-shaped report read as CreateX doesn't pass", () => {
    expect(failed(compareRelease(expected, faithfulReport("arachnid"), "createx-raw"))).toBe(true);
  });
});
