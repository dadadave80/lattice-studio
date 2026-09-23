import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { keccak256, type Hex } from "viem";
import { MULTICALL3_CODEHASH } from "./abi";

/** This file's path is `packages/core/src/deploy/abi.test.ts`; four levels up is the repo root, whatever the cwd is. */
const REPO_ROOT = join(import.meta.dir, "../../../..");

describe("MULTICALL3_CODEHASH", () => {
  test("equals keccak256 of e2e-chain/vendor's Multicall3 runtime file, not a fabricated value", () => {
    const code = readFileSync(join(REPO_ROOT, "e2e-chain/vendor/Multicall3.runtime.hex"), "utf8").trim() as Hex;
    expect(MULTICALL3_CODEHASH).toBe(keccak256(code));
  });
});
