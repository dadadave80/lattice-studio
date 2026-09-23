/**
 * Whether the real-build integration test may run `forge build` in a Lattice checkout. Only in one this run
 * owns: a WP's own checkout (claim.ts, `needs: lattice`) or the merge gate's `.integration/lattice`. Never in
 * the main checkout's `lattice/`, which is read-only (contracts §2) and which WPs without their own checkout
 * get as `LATTICE_DIR`: building there would write `out/` and `cache/` into it, and concurrent agents would
 * build into one `out/` unlocked.
 */
import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

/** A path with symlinks resolved; a path that doesn't exist yet is only made absolute. */
export function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export type RealBuildGate = { run: true; latticeDir: string } | { run: false; latticeDir: string; reason: string };

/**
 * `env` reads `LATTICE_DIR` and `STUDIO_MAIN` (the main checkout); `repoRoot` is this checkout's root, the
 * default for both; `which` finds a binary on PATH.
 */
export function realBuildGate(
  env: (name: string) => string | undefined,
  repoRoot: string,
  which: (bin: string) => string | null,
): RealBuildGate {
  const latticeDir = env("LATTICE_DIR") ?? join(repoRoot, "lattice");
  const mainLattice = join(env("STUDIO_MAIN") ?? repoRoot, "lattice");
  if (canonicalPath(latticeDir) === canonicalPath(mainLattice)) {
    return { run: false, latticeDir, reason: `${latticeDir} is the main checkout's read-only lattice/` };
  }
  for (const bin of ["forge", "anvil"]) {
    if (which(bin) === null) return { run: false, latticeDir, reason: `${bin} isn't installed` };
  }
  if (!existsSync(join(latticeDir, "foundry.toml")) || !existsSync(join(latticeDir, "lib", "diamond-lib", "src"))) {
    return { run: false, latticeDir, reason: `${latticeDir} isn't a Lattice checkout with its submodules` };
  }
  return { run: true, latticeDir };
}
