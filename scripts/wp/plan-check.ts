#!/usr/bin/env bun
// Validate .handoff/plan/wp.json after you add or change work packages (FX-*, split WPs):
// unique ids, known deps, no cycles, briefs present, nobody owns protected files, and no two WPs that
// could run at the same time own overlapping paths.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { repoPaths, loadPlan, planPath, REQUIRED_FIELDS, type Wp } from "./lib.ts";

const paths = repoPaths(process.cwd());
if (!paths) { console.error("Not inside a git repository."); process.exit(2); }
const plan = loadPlan(paths.main);
const by = new Map(plan.wps.map((w) => [w.id, w]));
const errors: string[] = [];
const warnings: string[] = [];

// Fields as written in the file (loadPlan fills defaults, so check the raw JSON).
const raw = JSON.parse(readFileSync(planPath(paths.main), "utf8")) as { wps: Record<string, unknown>[] };
for (const w of raw.wps) {
  const missing = REQUIRED_FIELDS.filter((f) => w[f] === undefined);
  if (missing.length) errors.push(`${String(w.id ?? "?")}: missing ${missing.join(", ")} (bun scripts/wp/add-wp.ts writes every field)`);
}

if (by.size !== plan.wps.length) errors.push("duplicate WP ids");
for (const w of plan.wps) {
  for (const d of w.deps) if (!by.has(d)) errors.push(`${w.id}: unknown dependency ${d}`);
  if (!new RegExp(`^(feat|fix|test|docs|chore)/wp-${w.id.toLowerCase()}$`).test(w.branch)) errors.push(`${w.id}: branch ${w.branch} must be <feat|fix|test|docs|chore>/wp-${w.id.toLowerCase()}`);
  if (!["opus", "sonnet"].includes(w.model)) errors.push(`${w.id}: model must be opus or sonnet`);
  const briefPath = join(paths.main, ".handoff", w.brief);
  if (!existsSync(briefPath)) errors.push(`${w.id}: brief ${w.brief} missing`);
  else if (/\bTODO\b/.test(readFileSync(briefPath, "utf8"))) warnings.push(`${w.id}: brief still has TODOs`);
  for (const g of w.gates) if (!plan.gates[g]) errors.push(`${w.id}: unknown gate ${g}`);
}

const ancestors = new Map<string, Set<string>>();
const visiting = new Set<string>();
function anc(id: string): Set<string> {
  if (ancestors.has(id)) return ancestors.get(id)!;
  if (visiting.has(id)) { errors.push(`dependency cycle through ${id}`); return new Set(); }
  visiting.add(id);
  const s = new Set<string>();
  for (const d of by.get(id)?.deps ?? []) { if (!by.has(d)) continue; s.add(d); for (const x of anc(d)) s.add(x); }
  visiting.delete(id);
  ancestors.set(id, s);
  return s;
}
for (const w of plan.wps) anc(w.id);

const GLOB = /[*?[{]/;
const prefix = (g: string) => { const m = GLOB.exec(g); return m ? g.slice(0, m.index) : g; };
function overlap(a: string, b: string): boolean {
  const pa = prefix(a), pb = prefix(b);
  const ea = pa === a, eb = pb === b;
  if (ea && eb) return a === b;
  if (ea) return new Bun.Glob(b).match(a) || a.startsWith(pb);
  if (eb) return new Bun.Glob(a).match(b) || b.startsWith(pa);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

for (const w of plan.wps) {
  const frozen = plan.frozenBy[w.id] ?? [];
  for (const g of w.owns) {
    const p = prefix(g);
    const hitsProtected = plan.protected.some((pg) => {
      if (frozen.includes(pg)) return false;
      return new Bun.Glob(pg).match(p.replace(/\/$/, "")) || new Bun.Glob(pg).match(g) || (pg.endsWith("/**") && p.startsWith(pg.slice(0, -2)));
    });
    if (hitsProtected) errors.push(`${w.id} owns protected ${g}`);
  }
}

const list = plan.wps;
for (let i = 0; i < list.length; i++) {
  for (let j = i + 1; j < list.length; j++) {
    const a = list[i] as Wp, b = list[j] as Wp;
    const ordered = anc(a.id).has(b.id) || anc(b.id).has(a.id);
    if (ordered) continue;
    for (const ga of a.owns) for (const gb of b.owns) {
      if (overlap(ga, gb)) errors.push(`${a.id} (${ga}) and ${b.id} (${gb}) can run at the same time and overlap`);
    }
  }
}

if (warnings.length) console.warn(warnings.join("\n"));
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`Plan OK: ${plan.wps.length} work packages.`);
