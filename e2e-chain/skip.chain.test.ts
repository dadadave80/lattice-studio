/**
 * `bun run test:chain` on a machine without Foundry skips cleanly: every suite says why and nothing fails. Proved by
 * running the whole folder again with Foundry's directory taken off PATH.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { ANVIL, FORGE, ROOT } from "./harness/env";

const NESTED = process.env["Q5_WITHOUT_FOUNDRY"] === "1";

describe.skipIf(NESTED || (ANVIL === null && FORGE === null))("without Foundry", () => {
  test("every chain suite skips with its reason and the run passes", () => {
    const path = (process.env["PATH"] ?? "")
      .split(delimiter)
      .filter((dir) => dir !== "" && !["anvil", "forge", "cast"].some((tool) => existsSync(join(dir, tool))))
      .join(delimiter);
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== "SEPOLIA_RPC_URL") env[key] = value;
    const proc = Bun.spawnSync([process.execPath, "test", "--config=e2e-chain/chain.bunfig.toml", "./e2e-chain"], {
      cwd: ROOT,
      env: { ...env, PATH: path, Q5_WITHOUT_FOUNDRY: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = `${proc.stdout.toString()}${proc.stderr.toString()}`;
    expect(out).toContain("CreateX parity: skipped, anvil isn't on PATH (install Foundry 1.8.3).");
    expect(out).toContain("shared contracts: skipped, anvil isn't on PATH (install Foundry 1.8.3).");
    expect(out).toContain("core-built deploys: skipped, anvil isn't on PATH (install Foundry 1.8.3).");
    expect(out).toContain("exported scripts: skipped, anvil isn't on PATH (install Foundry 1.8.3).");
    expect(out).toContain("Sepolia fork: skipped, anvil isn't on PATH (install Foundry 1.8.3).");
    expect(out).toMatch(/\b0 pass\b/);
    expect(out).toMatch(/\b0 fail\b/);
    expect(proc.exitCode).toBe(0);
  }, 60_000);
});
