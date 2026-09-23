#!/usr/bin/env bun
// Add a fix package (or split a WP) to .handoff/plan/wp.json and write its brief skeleton, with every field the
// scripts and hooks need. Then fill in the brief and run plan-check.
//
//   bun scripts/wp/add-wp.ts --id FX3 --title "Inspector chain-row states" --owns "apps/studio/src/panels/inspector/**" \
//     --deps S5c --model sonnet [--review opus] [--gates typecheck,lint,test,browser] [--needs foundry] [--helpers 0] [--wave 5]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoPaths, loadPlan, planPath, fail } from "./lib.ts";

const args = process.argv.slice(2);
const val = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const list = (name: string) => (val(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const id = val("id");
const title = val("title");
const owns = list("owns");
const model = val("model") ?? "sonnet";
if (!id || !/^[A-Za-z][A-Za-z0-9]*$/.test(id) || !title || !owns.length) {
  fail("Usage: bun scripts/wp/add-wp.ts --id FX3 --title \"…\" --owns \"glob,glob\" --deps A,B [--model sonnet|opus] [--review …] [--gates …] [--needs …] [--helpers n] [--wave 5]", 2);
}
if (!["opus", "sonnet"].includes(model)) fail("--model must be opus or sonnet.", 2);

const paths = repoPaths(process.cwd());
if (!paths) fail("Not inside a git repository.", 2);
const main = paths!.main;
const plan = loadPlan(main);
if (plan.wps.some((w) => w.id.toLowerCase() === id!.toLowerCase())) fail(`${id} already exists.`, 2);
const deps = list("deps");
for (const d of deps) if (!plan.wps.some((w) => w.id === d)) fail(`Unknown dependency ${d}.`, 2);
const gates = list("gates").length ? list("gates") : owns.some((g) => g.startsWith("apps/studio/")) ? ["typecheck", "lint", "test", "browser"] : ["typecheck", "lint", "test"];
for (const g of gates) if (!plan.gates[g]) fail(`Unknown gate ${g}. Known: ${Object.keys(plan.gates).join(", ")}.`, 2);

const isFix = /^FX/i.test(id!);
const entry = {
  id: id!, title: title!, wave: Number(val("wave") ?? 5), model, review: val("review") ?? model,
  branch: `${isFix ? "fix" : "feat"}/wp-${id!.toLowerCase()}`, deps, owns, needs: list("needs"), gates,
  helpers: Number(val("helpers") ?? 0), priority: Number(val("priority") ?? 5), brief: `plan/wp/${id}.md`,
};

const raw = JSON.parse(readFileSync(planPath(main), "utf8"));
raw.wps.push(entry);
writeFileSync(planPath(main), JSON.stringify(raw, null, 2) + "\n");

const brief = join(main, ".handoff", entry.brief);
if (!existsSync(brief)) {
  writeFileSync(brief, `# WP-${entry.id} · ${entry.title}

| | |
| --- | --- |
| Wave | ${entry.wave}${isFix ? " (fix)" : ""} |
| Model | ${entry.model}, effort high · reviewer ${entry.review} |
| Branch | \`${entry.branch}\` |
| Depends on | ${deps.join(", ") || "none"} |
| Merge gates | ${gates.join(", ")} |

## Goal

TODO: one or two sentences: what's wrong or missing, and what done looks like.

## You own

${owns.map((g) => `- \`${g}\``).join("\n")}

Everything else is read-only for you. Need a change elsewhere? Put a contract change request in your report.

## Read first

- \`.handoff/plan/contracts.md\` §1 and §6
- TODO: the audit rows or review items, with spec lines
- TODO: the original brief for this module

## Build

- TODO

## Done when

- [ ] TODO: a test per item that would fail without the fix
- [ ] These pass in your worktree: TODO commands
`);
}
console.log(`Added ${entry.id} (${entry.branch}). Now write ${brief}, then run bun scripts/wp/plan-check.ts.`);
