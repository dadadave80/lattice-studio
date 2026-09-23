import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AbiItem, Hex, Hex4 } from "@lattice-studio/core";
import { encodeAbiParameters } from "viem";
import {
  type Artifact,
  checkBuildOutputs,
  checkSelectors,
  decodeExportSelectors,
  describeMismatch,
  findArtifact,
  libraryPlaceholder,
  linkBytecode,
  parseArtifact,
  RECEIVE_SELECTOR,
  SELF_SELECTOR,
  shardAbi,
} from "../../src/artifacts";

const OUT = join(import.meta.dir, "fixtures", "lattice", "out");

async function load(file: string, contract: string): Promise<Artifact> {
  const result = await findArtifact(OUT, { file, contract });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

async function raw(file: string, contract: string): Promise<Record<string, unknown>> {
  return (await Bun.file(join(OUT, file, `${contract}.json`)).json()) as Record<string, unknown>;
}

function error<T>(result: { ok: true; value: T } | { ok: false; error: string }): string {
  if (result.ok) throw new Error("expected a failure");
  return result.error;
}

const ERC20_EXPORT: Hex4[] = [
  "0xdd62ed3e",
  "0x095ea7b3",
  "0x70a08231",
  "0x313ce567",
  "0x06fdde03",
  "0x95d89b41",
  "0x18160ddd",
  "0xa9059cbb",
  "0x23b872dd",
];

describe("parseArtifact", () => {
  test("reads ABI, method identifiers, bytecode, storage layout and solc's metadata", async () => {
    const a = await load("ERC20.sol", "ERC20");
    expect(a.contract).toBe("ERC20");
    expect(a.sourcePath).toBe("src/tokens/ERC20/ERC20.sol");
    expect(a.path).toBe(join(OUT, "ERC20.sol", "ERC20.json"));
    const kinds = a.abi.map((i) => i.type);
    expect(kinds.filter((k) => k === "function")).toHaveLength(10);
    expect(kinds.filter((k) => k === "error")).toHaveLength(6);
    expect(kinds.filter((k) => k === "event")).toHaveLength(2);
    expect(a.methodIdentifiers["transfer(address,uint256)"]).toBe("0xa9059cbb");
    expect(a.methodIdentifiers["exportSelectors()"]).toBe(SELF_SELECTOR);
    expect(a.bytecode.object.startsWith("0x6080")).toBe(true);
    expect(a.bytecode.linkReferences).toEqual({});
    expect(a.deployedBytecode.immutableReferences).toEqual({});
    expect(a.storageLayout).toEqual({ storage: [], types: {} });
    expect(a.metadata.compiler.version).toBe("0.8.36+commit.8a079791");
    expect(a.metadata.settings.optimizer).toEqual({ enabled: true, runs: 1_000_000 });
    expect(a.metadata.settings.evmVersion).toBe("osaka");
    expect(Object.keys(a.metadata.sources)).toContain("src/tokens/ERC20/ERC20.sol");
    // Contract-level NatSpec is only in rawMetadata; forge's parsed `metadata` drops it.
    expect(a.metadata.output.userdoc.notice).toBe("Stateless Diamond facet for the ERC-20 token standard.");
    expect(a.metadata.output.devdoc["custom:lattice-version"]).toBe("0.1.0");
  });

  test("refuses an artifact without rawMetadata", async () => {
    const json = await raw("ERC20.sol", "ERC20");
    delete json.rawMetadata;
    expect(error(parseArtifact(json, "ERC20", "x.json"))).toBe("x.json: rawMetadata Invalid input: expected string, received undefined");
  });

  test("refuses metadata for another contract", async () => {
    expect(error(parseArtifact(await raw("ERC20.sol", "ERC20"), "ERC721", "x.json"))).toBe(
      'x.json: compilationTarget {"src/tokens/ERC20/ERC20.sol":"ERC20"} isn\'t ERC721.',
    );
  });

  test("refuses malformed bytecode and selectors", async () => {
    const json = await raw("ERC20.sol", "ERC20");
    json.bytecode = { object: "0xzz", linkReferences: {} };
    json.methodIdentifiers = { "f()": "123" };
    const message = error(parseArtifact(json, "ERC20", "x.json"));
    expect(message).toContain("bytecode.object is not bytecode");
    expect(message).toContain("methodIdentifiers.f() is not a selector");
  });

  test("refuses rawMetadata that isn't JSON", async () => {
    const json = await raw("ERC20.sol", "ERC20");
    json.rawMetadata = "{";
    expect(error(parseArtifact(json, "ERC20", "x.json"))).toBe("x.json: rawMetadata isn't JSON.");
  });
});

describe("findArtifact", () => {
  let dir = "";
  beforeAll(async () => {
    // Two contracts named ERC20 in files named ERC20.sol: forge nests the second one deeper.
    dir = await mkdtemp(join(tmpdir(), "cg1-out-"));
    const first = await raw("ERC20.sol", "ERC20");
    const second = structuredClone(first);
    const meta = JSON.parse(second.rawMetadata as string) as { settings: { compilationTarget: Record<string, string> } };
    meta.settings.compilationTarget = { "test/mocks/ERC20.sol": "ERC20" };
    second.rawMetadata = JSON.stringify(meta);
    await mkdir(join(dir, "ERC20.sol"), { recursive: true });
    await mkdir(join(dir, "mocks", "ERC20.sol"), { recursive: true });
    await writeFile(join(dir, "ERC20.sol", "ERC20.json"), JSON.stringify(second));
    await writeFile(join(dir, "mocks", "ERC20.sol", "ERC20.json"), JSON.stringify(first));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("resolves a basename entry through its metadata", async () => {
    const a = await load("DiamondCutFacet.sol", "DiamondCutFacet");
    expect(a.sourcePath).toBe("lib/diamond-lib/src/facets/DiamondCutFacet.sol");
  });

  test("picks the artifact whose source path matches when basenames collide", async () => {
    const result = await findArtifact(dir, { file: "ERC20.sol", contract: "ERC20", sourcePath: "src/tokens/ERC20/ERC20.sol" });
    expect(result.ok && result.value.path).toBe(join(dir, "mocks", "ERC20.sol", "ERC20.json"));
  });

  test("refuses an ambiguous basename", async () => {
    expect(error(await findArtifact(dir, { file: "ERC20.sol", contract: "ERC20" }))).toBe(
      "2 artifacts match ERC20.sol:ERC20: src/tokens/ERC20/ERC20.sol, test/mocks/ERC20.sol.",
    );
  });

  test("an unreadable flat artifact doesn't stop the search; it's reported only when nothing matches", async () => {
    const broken = await mkdtemp(join(tmpdir(), "cg1-out-"));
    try {
      await mkdir(join(broken, "ERC20.sol"), { recursive: true });
      await mkdir(join(broken, "tokens", "ERC20.sol"), { recursive: true });
      await writeFile(join(broken, "ERC20.sol", "ERC20.json"), "{");
      await writeFile(join(broken, "tokens", "ERC20.sol", "ERC20.json"), JSON.stringify(await raw("ERC20.sol", "ERC20")));
      const found = await findArtifact(broken, { file: "ERC20.sol", contract: "ERC20", sourcePath: "src/tokens/ERC20/ERC20.sol" });
      expect(found.ok && found.value.path).toBe(join(broken, "tokens", "ERC20.sol", "ERC20.json"));

      const missing = await findArtifact(broken, { file: "ERC20.sol", contract: "ERC20", sourcePath: "src/Other.sol" });
      expect(error(missing)).toBe(
        `no artifact for src/Other.sol:ERC20 under ${broken}. Build with FOUNDRY_PROFILE=ci forge build. Unreadable: ${join(broken, "ERC20.sol", "ERC20.json")} isn't JSON.`,
      );
    } finally {
      await rm(broken, { recursive: true, force: true });
    }
  });

  test("says how to build when nothing matches", async () => {
    expect(error(await findArtifact(OUT, { file: "ERC20.sol", contract: "ERC20", sourcePath: "src/Other.sol" }))).toBe(
      `no artifact for src/Other.sol:ERC20 under ${OUT}. Build with FOUNDRY_PROFILE=ci forge build.`,
    );
  });
});

describe("linkBytecode", () => {
  const file = "lib/poseidon-solidity/PoseidonT3.sol";
  const placeholder = libraryPlaceholder(file, "PoseidonT3");
  const refs = { [file]: { PoseidonT3: [{ start: 1, length: 20 }, { start: 22, length: 20 }] } };
  const code = `0x73${placeholder}ff${placeholder}00`;
  const lib = "0x00000000000000000000000000000000000000AB";

  test("the placeholder is solc's: keccak256 of <file>:<Lib>, first 17 bytes", () => {
    // As it appears in ShieldedPool's and Semaphore's creation code at the pin.
    expect(placeholder).toBe("__$8aba30fc7548bf6094b92809f1a8df23b1$__");
  });

  test("fills every reference with the address", () => {
    const addr = lib.slice(2).toLowerCase();
    expect(linkBytecode(code, refs, { [`${file}:PoseidonT3`]: lib })).toEqual({ ok: true, value: `0x73${addr}ff${addr}00` });
  });

  test("returns unlinked code unchanged, lowercased", () => {
    expect(linkBytecode("0x60AB", {}, {})).toEqual({ ok: true, value: "0x60ab" });
  });

  test("refuses a missing address", () => {
    expect(error(linkBytecode(code, refs, {}))).toBe(`needs library ${file}:PoseidonT3 linked; no address given.`);
  });

  test("refuses an address that isn't 20 bytes", () => {
    expect(error(linkBytecode(code, refs, { [`${file}:PoseidonT3`]: "0x1234" }))).toBe(
      `library ${file}:PoseidonT3 address 0x1234 isn't 20 bytes.`,
    );
  });

  test("refuses a reference that doesn't point at the placeholder", () => {
    const wrong = { [file]: { PoseidonT3: [{ start: 2, length: 20 }] } };
    expect(error(linkBytecode(code, wrong, { [`${file}:PoseidonT3`]: lib }))).toBe(
      `library ${file}:PoseidonT3: no placeholder at byte 2.`,
    );
  });

  test("refuses code that is still unlinked", () => {
    expect(error(linkBytecode(`0x73${placeholder}`, {}, {}))).toBe("bytecode is still unlinked or malformed.");
  });
});

describe("decodeExportSelectors", () => {
  const encode = (packed: Hex): Hex => encodeAbiParameters([{ type: "bytes" }], [packed]);

  test("splits the packed bytes into selectors, in order", () => {
    expect(decodeExportSelectors(encode("0xDD62ED3E095ea7b3"))).toEqual({ ok: true, value: ["0xdd62ed3e", "0x095ea7b3"] });
  });

  test("keeps Receive's zero selector", () => {
    expect(decodeExportSelectors(encode("0x00000000"))).toEqual({ ok: true, value: [RECEIVE_SELECTOR] });
  });

  test("refuses an empty export, a ragged one and data that isn't bytes", () => {
    expect(error(decodeExportSelectors(encode("0x")))).toBe("exportSelectors() returned no selectors.");
    expect(error(decodeExportSelectors(encode("0x0102030405")))).toBe(
      "exportSelectors() returned 5 bytes, not a multiple of 4.",
    );
    expect(error(decodeExportSelectors("0x1234"))).toBe("exportSelectors() didn't return ABI-encoded bytes.");
  });
});

describe("checkSelectors", () => {
  test("names each exported selector from the ABI, in export order, minus 0x0ef22643", async () => {
    const a = await load("ERC20.sol", "ERC20");
    const result = checkSelectors("ERC20", [...ERC20_EXPORT, SELF_SELECTOR], a);
    expect(result.mismatches).toEqual([]);
    expect(result.selectors.map((s) => s.hex)).toEqual(ERC20_EXPORT);
    expect(result.selectors[0]).toEqual({ hex: "0xdd62ed3e", signature: "allowance(address,address)" });
  });

  test("reports what the ABI lists but the export leaves out, extras, and duplicates", async () => {
    const a = await load("ERC20.sol", "ERC20");
    const exported: Hex4[] = [...ERC20_EXPORT.slice(1), "0x12345678", "0x095ea7b3"];
    const { mismatches } = checkSelectors("ERC20", exported, a);
    expect(mismatches).toEqual([
      { kind: "not-in-abi", facet: "ERC20", selector: "0x12345678" },
      { kind: "duplicate", facet: "ERC20", selector: "0x095ea7b3" },
      { kind: "not-exported", facet: "ERC20", selector: "0xdd62ed3e", signature: "allowance(address,address)" },
    ]);
    expect(mismatches.map(describeMismatch)).toEqual([
      "ERC20 exports 0x12345678, which its ABI doesn't list.",
      "ERC20 exports 0x095ea7b3 more than once.",
      "ERC20 doesn't export allowance(address,address) (0xdd62ed3e), which its ABI lists.",
    ]);
  });

  test("records Receive's 0x00000000 as receive()", async () => {
    const a = await load("Receive.sol", "Receive");
    expect(checkSelectors("Receive", [RECEIVE_SELECTOR], a)).toEqual({
      selectors: [{ hex: "0x00000000", signature: "receive()" }],
      mismatches: [],
    });
  });

  test("0x00000000 from a facet without receive() isn't in its ABI", async () => {
    const a = await load("ERC20.sol", "ERC20");
    const { mismatches } = checkSelectors("ERC20", [...ERC20_EXPORT, RECEIVE_SELECTOR], a);
    expect(mismatches).toEqual([{ kind: "not-in-abi", facet: "ERC20", selector: RECEIVE_SELECTOR }]);
  });
});

describe("shardAbi", () => {
  test("keeps functions, errors and events and drops exportSelectors()", async () => {
    const a = await load("DiamondCutFacet.sol", "DiamondCutFacet");
    const abi = shardAbi(a.abi);
    expect(abi.filter((i) => i.type === "function").map((i) => (i as { name: string }).name)).toEqual(["diamondCut"]);
    expect(abi.filter((i) => i.type === "error")).toHaveLength(11);
    expect(abi.filter((i) => i.type === "event")).toHaveLength(1);
  });

  test("drops receive, fallback and constructor entries", async () => {
    const a = await load("Receive.sol", "Receive");
    const extra: AbiItem[] = [
      { type: "constructor", inputs: [], stateMutability: "nonpayable" },
      { type: "fallback", stateMutability: "payable" },
    ];
    expect(shardAbi([...a.abi, ...extra])).toEqual([]);
  });
});

describe("checkBuildOutputs", () => {
  test("the ci profile's storage layout and build info are there", async () => {
    expect(await checkBuildOutputs(OUT, await load("ERC20.sol", "ERC20"))).toEqual({
      storageLayout: true,
      buildInfo: true,
      missing: [],
    });
  });

  test("names the foundry.toml settings a build without them needs", async () => {
    const a = await load("ERC20.sol", "ERC20");
    const { storageLayout: _, ...bare } = a;
    expect(await checkBuildOutputs(join(OUT, "ERC20.sol"), bare)).toEqual({
      storageLayout: false,
      buildInfo: false,
      missing: ['extra_output = ["storageLayout"]', "build_info = true"],
    });
  });
});
