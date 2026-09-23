/**
 * What the chain tests need from the machine: Foundry's `anvil` and `forge`, a Lattice checkout with forge-std, and
 * this worktree's Anvil ports (contracts §2, Ports and environment). Every value comes from `process.env`, then the
 * repo root's `.env.local`; nothing here binds a fixed port.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "../..");

function fromEnvFile(key: string): string | undefined {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  const value = line?.slice(key.length + 1).trim();
  return value === "" ? undefined : value;
}

/** `process.env[key]`, then `.env.local`'s line. */
export function envValue(key: string): string | undefined {
  const own = process.env[key];
  return own !== undefined && own !== "" ? own : fromEnvFile(key);
}

export const ANVIL = Bun.which("anvil");
export const FORGE = Bun.which("forge");

/** The Lattice checkout whose forge-std the generated scripts compile against. */
export const LATTICE = [envValue("LATTICE_DIR"), join(ROOT, "lattice")].find(
  (dir): dir is string => dir !== undefined && existsSync(join(dir, "lib/forge-std/src/Script.sol")),
);

/** Why the Foundry suites skip on this machine, or undefined when they run. */
export const SKIP_REASON: string | undefined =
  ANVIL === null
    ? "anvil isn't on PATH (install Foundry 1.8.3)"
    : FORGE === null
      ? "forge isn't on PATH (install Foundry 1.8.3)"
      : LATTICE === undefined
        ? "no Lattice checkout with lib/forge-std (set LATTICE_DIR or init the lattice submodule)"
        : undefined;

/** Anvil only: suites that never run forge. */
export const ANVIL_SKIP_REASON: string | undefined = ANVIL === null ? "anvil isn't on PATH (install Foundry 1.8.3)" : undefined;

/**
 * The port for one test file's Anvil node: `ANVIL_PORT_BASE` plus that file's offset. A worktree's slot is 20 ports
 * wide and the first three are the app's, so offsets 0-16 stay inside it. Without a base, 8545 plus the offset.
 */
export function anvilPort(offset: number): number {
  if (!Number.isInteger(offset) || offset < 0 || offset > 16) throw new RangeError(`Anvil port offset ${offset} is outside 0-16`);
  const base = Number(envValue("ANVIL_PORT_BASE") ?? "8545");
  if (!Number.isInteger(base) || base <= 0) throw new RangeError(`ANVIL_PORT_BASE isn't a port: ${envValue("ANVIL_PORT_BASE")}`);
  return base + offset;
}

/** Offsets, one per test file, so no two files ever share a node. */
export const PORT = { createx: 0, shared: 1, deploy: 2, scripts: 3, fork: 4, scrub: 5 } as const;

/** Prints once why a suite skips, so a skipped run says so instead of passing silently. */
export function announceSkip(suite: string, reason: string | undefined): void {
  if (reason !== undefined) console.log(`${suite}: skipped, ${reason}.`);
}
