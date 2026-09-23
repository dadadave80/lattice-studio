import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCreate2Address, keccak256 } from "viem";
import { ARACHNID_DEPLOYER, arachnidTarget, startAnvil, studioEnv, ZERO_SALT } from "../../src/anvil";

describe("studioEnv", () => {
  let root = "";
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "cg1-env-"));
    await writeFile(
      join(root, ".env.local"),
      "# comment\nCG1_PROBE_A=20123\n  CG1_PROBE_B = \"/some/dir\" \nCG1_PROBE_C='x'\n",
    );
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    delete process.env.CG1_PROBE_A;
  });

  test("reads the repo root's .env.local, which bun test doesn't load", () => {
    expect(studioEnv("CG1_PROBE_A", root)).toBe("20123");
    expect(studioEnv("CG1_PROBE_B", root)).toBe("/some/dir");
    expect(studioEnv("CG1_PROBE_C", root)).toBe("x");
    expect(studioEnv("CG1_PROBE_MISSING", root)).toBeUndefined();
    expect(studioEnv("CG1_PROBE_A", join(root, "nowhere"))).toBeUndefined();
  });

  test("the environment wins", () => {
    process.env.CG1_PROBE_A = "1";
    expect(studioEnv("CG1_PROBE_A", root)).toBe("1");
  });
});

describe("arachnidTarget", () => {
  test("is CREATE2 from Arachnid's proxy with the salt passed as given", () => {
    const code = "0x6000";
    expect(arachnidTarget(code)).toBe(
      getCreate2Address({ from: ARACHNID_DEPLOYER, salt: ZERO_SALT, bytecodeHash: keccak256(code) }),
    );
    const salt = keccak256("0x01");
    expect(arachnidTarget(code, salt)).toBe(getCreate2Address({ from: ARACHNID_DEPLOYER, salt, bytecodeHash: keccak256(code) }));
    expect(arachnidTarget(code, salt)).not.toBe(arachnidTarget(code));
  });
});

describe("startAnvil", () => {
  test("says when anvil isn't installed", async () => {
    expect(await startAnvil({ bin: "anvil-that-is-not-installed" })).toEqual({
      ok: false,
      error: "anvil-that-is-not-installed isn't installed. Install Foundry 1.8.3.",
    });
  });
});
