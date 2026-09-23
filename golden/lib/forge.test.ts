import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SetupError, artifactSignatures, latticeDir, parseForgeJson, readEnvValue } from "./forge.ts";

const tmp = mkdtempSync(join(tmpdir(), "studio-golden-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("parseForgeJson", () => {
  test("reads status, reason and decoded logs per test", () => {
    const json = JSON.stringify({
      "test/x/H.t.sol:H": {
        duration: "1ms",
        test_results: {
          "test_A()": { status: "Success", reason: null, decoded_logs: ["STUDIO_GOLDEN recipe A s b"], traces: [] },
          "test_B()": { status: "Failure", reason: "boom", decoded_logs: [] },
        },
        warnings: [],
      },
    });
    expect(parseForgeJson(json)).toEqual([
      { suite: "test/x/H.t.sol:H", test: "test_A()", ok: true, reason: null, logs: ["STUDIO_GOLDEN recipe A s b"] },
      { suite: "test/x/H.t.sol:H", test: "test_B()", ok: false, reason: "boom", logs: [] },
    ]);
  });
});

describe("latticeDir", () => {
  const lattice = join(tmp, "lat");
  mkdirSync(lattice, { recursive: true });
  writeFileSync(join(lattice, "foundry.toml"), "");

  test("prefers $LATTICE_DIR, then .env.local, then lattice/", () => {
    expect(latticeDir({ LATTICE_DIR: lattice }, "/nowhere")).toBe(lattice);
    const root = join(tmp, "repo");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, ".env.local"), `# ports\nSTUDIO_PORT=1\nLATTICE_DIR="${lattice}"\n`);
    expect(latticeDir({}, root)).toBe(lattice);
    rmSync(join(root, ".env.local"));
    mkdirSync(join(root, "lattice"));
    writeFileSync(join(root, "lattice", "foundry.toml"), "");
    expect(latticeDir({}, root)).toBe(join(root, "lattice"));
  });

  test("says what's missing when there's no checkout", () => {
    expect(() => latticeDir({ LATTICE_DIR: join(tmp, "missing") })).toThrow(SetupError);
  });
});

describe("readEnvValue", () => {
  test("handles comments, export and quotes", () => {
    const text = "# c\nexport A='x y'\nB=2\n";
    expect(readEnvValue(text, "A")).toBe("x y");
    expect(readEnvValue(text, "B")).toBe("2");
    expect(readEnvValue(text, "C")).toBeUndefined();
  });
});

describe("artifactSignatures", () => {
  const out = join(tmp, "sig", "out");
  const artifact = (target: string, ids: Record<string, string>) =>
    JSON.stringify({ methodIdentifiers: ids, metadata: { settings: { compilationTarget: { [target]: "X" } } } });
  mkdirSync(join(out, "ERC20.sol"), { recursive: true });
  writeFileSync(join(out, "ERC20.sol", "ERC20.json"), artifact("src/tokens/ERC20/ERC20.sol", { "transfer(address,uint256)": "a9059cbb" }));
  mkdirSync(join(out, "lib", "x", "ERC20.sol"), { recursive: true });
  writeFileSync(join(out, "lib", "x", "ERC20.sol", "ERC20.json"), artifact("lib/x/ERC20.sol", { "name()": "06fdde03" }));

  test("finds the artifact whose source matches the id, by basename or full path", () => {
    const lookup = artifactSignatures(join(tmp, "sig"));
    expect(lookup("src/tokens/ERC20/ERC20.sol:ERC20", "0xa9059cbb")).toBe("transfer(address,uint256)");
    expect(lookup("lib/x/ERC20.sol:ERC20", "0x06fdde03")).toBe("name()");
    expect(lookup("lib/x/ERC20.sol:ERC20", "0xa9059cbb")).toBeUndefined();
    expect(() => lookup("Nope.sol:Nope", "0x00000000")).toThrow(/No build artifact/);
  });
});
