#!/usr/bin/env bun
// Type-check every workspace project. Default: TypeScript 7 (native). `--ts6`: TypeScript 6.0 (tooling pin).
// Both compilers declare a `tsc` bin, so each is called by its package path, never through node_modules/.bin.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const ts6 = process.argv.includes("--ts6");
const pkg = ts6 ? "typescript" : "@typescript/native";
const tsc = join(root, "node_modules", pkg, "bin", "tsc");
if (!existsSync(tsc)) { console.error(`${pkg} isn't installed; run bun install.`); process.exit(2); }

const projects: string[] = [];
for (const group of ["packages", "apps"]) {
  const dir = join(root, group);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const cfg = join(dir, name, "tsconfig.json");
    if (existsSync(cfg) && hasSources(join(dir, name))) projects.push(cfg);
  }
}
for (const extra of ["scripts/tsconfig.json", "golden/tsconfig.json", "e2e-chain/tsconfig.json", "fixtures/tsconfig.json"]) {
  const cfg = join(root, extra);
  if (existsSync(cfg) && hasSources(join(cfg, ".."))) projects.push(cfg);
}

let failed = 0;
for (const cfg of projects) {
  const p = Bun.spawnSync(["node", tsc, "-p", cfg, "--noEmit"], { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) failed++;
}
console.log(`${ts6 ? "TypeScript 6" : "TypeScript 7"}: ${projects.length - failed}/${projects.length} projects clean.`);
process.exit(failed ? 1 : 0);

function hasSources(dir: string): boolean {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) stack.push(p);
      else if (/\.(ts|tsx)$/.test(e) && !e.endsWith(".d.ts")) return true;
    }
  }
  return false;
}
