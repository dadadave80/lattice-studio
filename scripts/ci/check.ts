#!/usr/bin/env bun
// `bun run check` (brief Q6, spec L897): typecheck (TS 7 and TS 6), lint, size budgets, schema drift, token
// drift, a raw-color scan and copy-lint. Every step runs even after an earlier one fails, so one `bun run
// check` shows everything wrong at once; the summary at the end says which passed.
import { join } from "node:path";
import { CHECK_STEPS } from "./check-steps.ts";

const root = join(import.meta.dir, "..", "..");

function main(): void {
  const results: { name: string; ok: boolean }[] = [];
  for (const step of CHECK_STEPS) {
    console.log(`\n▶ ${step.name} (${step.cmd.join(" ")})`);
    const p = Bun.spawnSync([...step.cmd], { cwd: root, stdout: "inherit", stderr: "inherit" });
    results.push({ name: step.name, ok: p.exitCode === 0 });
  }

  console.log("\ncheck ·");
  for (const r of results) console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.name}`);

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\ncheck · fail, ${failed.length} of ${results.length} steps failed: ${failed.map((r) => r.name).join(", ")}.`);
    process.exit(1);
  }
  console.log(`\ncheck · pass, ${results.length} steps.`);
}

main();
