/**
 * A throwaway Foundry project for the exported scripts: forge-std from the Lattice checkout (the only import a
 * generated script has), the catalog's solc, no network for compilers. Removed in `dispose`.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address } from "viem";
import { FORGE, LATTICE } from "./env";
import { scrub } from "./scrub";

/** Environment variables forge never gets. */
const WITHHELD = new Set(["FOUNDRY_PROFILE", "SEPOLIA_RPC_URL"]);

export type ForgeResult = { code: number; out: string };

export class ForgeProject {
  readonly dir: string;

  constructor(solc: string) {
    if (FORGE === null || LATTICE === undefined) throw new Error("forge or the Lattice checkout is missing");
    this.dir = mkdtempSync(join(tmpdir(), "q5-scripts-"));
    for (const sub of ["script", "lib"]) mkdirSync(join(this.dir, sub));
    symlinkSync(join(LATTICE, "lib/forge-std"), join(this.dir, "lib/forge-std"));
    writeFileSync(
      join(this.dir, "foundry.toml"),
      [
        "[profile.default]",
        'src = "script"',
        'out = "out"',
        'libs = ["lib"]',
        `solc_version = "${solc}"`,
        "offline = true",
        'remappings = ["forge-std/=lib/forge-std/src/"]',
        "",
      ].join("\n"),
    );
  }

  write(filename: string, text: string): void {
    writeFileSync(join(this.dir, "script", filename), text);
  }

  /**
   * Runs forge in the project, without the caller's FOUNDRY_PROFILE (Lattice's `ci` profile isn't this project's) or
   * SEPOLIA_RPC_URL (forge never needs it: every run targets the local node). Output is scrubbed of a fork's URL.
   */
  run(args: string[]): ForgeResult {
    const env: Record<string, string> = { FOUNDRY_DISABLE_NIGHTLY_WARNING: "true", NO_COLOR: "1" };
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !WITHHELD.has(key)) env[key] = value;
    const proc = Bun.spawnSync([FORGE ?? "forge", ...args], { cwd: this.dir, env, stdout: "pipe", stderr: "pipe" });
    return { code: proc.exitCode, out: scrub(`${proc.stdout.toString()}${proc.stderr.toString()}`) };
  }

  /**
   * `forge script <file>:<contract> --broadcast` against a local node, as an unlocked Anvil account: the node
   * signs, so no key is ever passed. The header's `--account deployer` is for a real deployer's keystore.
   */
  broadcast(filename: string, contract: string, rpcUrl: string, sender: Address): ForgeResult {
    return this.run([
      "script",
      `script/${filename}:${contract}`,
      "--rpc-url",
      rpcUrl,
      "--broadcast",
      "--unlocked",
      "--sender",
      sender,
      "--non-interactive",
    ]);
  }

  dispose(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}
