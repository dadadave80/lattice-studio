#!/usr/bin/env bun
// `bun scripts/ci/react-compiler-dist-check.ts [--build]`: fails unless `apps/studio/dist`'s built JS carries
// proof the React Compiler ran (spec L902, §17 audit #14). `--build` runs `bun run build` first, same as
// `size.ts`. Without `--build`, checks whatever is already in `apps/studio/dist/`, or says there's nothing to
// check and exits 0 (a plain `bun run check` shouldn't force a build just for this).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { hasCompilerRuntime } from "./react-compiler-dist-check-logic.ts";

const root = join(import.meta.dir, "..", "..");
const distDir = join(root, "apps", "studio", "dist");

function jsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

async function main(): Promise<void> {
  const build = process.argv.includes("--build");

  if (build) {
    console.log("react-compiler-dist-check · running `bun run build`…");
    const p = Bun.spawnSync(["bun", "run", "build"], { cwd: root, stdout: "inherit", stderr: "inherit" });
    if (p.exitCode !== 0) {
      console.error("react-compiler-dist-check · `bun run build` failed; see above.");
      process.exit(1);
    }
  }

  if (!existsSync(distDir)) {
    console.log(`react-compiler-dist-check · no build at ${relative(root, distDir)}; run with --build for a full check. Skipping.`);
    process.exit(0);
  }

  const files = jsFiles(distDir);
  const texts = files.map((f) => readFileSync(f, "utf8"));
  if (!hasCompilerRuntime(texts)) {
    console.error(
      `react-compiler-dist-check · fail: none of ${files.length} built .js files carries Symbol.for("react.memo_cache_sentinel"), the ` +
        `React Compiler's own signature. The preset (vite.config.ts, spec L902) may be missing or misconfigured.`,
    );
    process.exit(1);
  }
  console.log(`react-compiler-dist-check · pass, found the React Compiler's memo_cache_sentinel across ${files.length} built .js files.`);
}

await main();
