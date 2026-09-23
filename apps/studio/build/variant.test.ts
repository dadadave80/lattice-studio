import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildVariant } from "./variant.ts";

/** `env.hashRouting` as the app computes it in a build of `mode` (under Bun, `import.meta.env` is the process env). */
function hashRoutingIn(mode: string): boolean {
  const envFile = join(import.meta.dir, "..", "src", "contracts", "env.ts");
  const run = Bun.spawnSync(["bun", "-e", `import { env } from ${JSON.stringify(envFile)}; process.stdout.write(String(env.hashRouting));`], {
    env: { ...process.env, MODE: mode },
  });
  return run.stdout.toString() === "true";
}

describe("buildVariant", () => {
  test("the IPFS build (relative base, CSP meta) is exactly the build the app hash-routes in", () => {
    for (const mode of ["ipfs", "production", "e2e", "test"]) expect(hashRoutingIn(mode)).toBe(buildVariant({ mode }) === "ipfs");
  });
});
