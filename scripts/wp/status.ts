#!/usr/bin/env bun
// Where every work package stands, from git (refs/wp/merged/*, branches, worktrees) and the ledger's STARTED lines.
//   bun scripts/wp/status.ts                      table of all WPs
//   bun scripts/wp/status.ts --ready              ready WPs, highest priority first: deps landed, not started, not claimed
//   bun scripts/wp/status.ts --json               machine-readable
//   bun scripts/wp/status.ts --start <ID> [--agent <agentId>]   record that you spawned an implementer for <ID>
//   bun scripts/wp/status.ts --stop <ID>          forget a start whose agent died before claiming (so it's ready again)
import { repoPaths, loadPlan, findWp, branchExists, git, worktrees, mergeCommit, ledger, ledgerLines, fail, type Wp } from "./lib.ts";

const args = process.argv.slice(2);
const val = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const paths = repoPaths(process.cwd());
if (!paths) fail("Not inside a git repository.", 2);
const { main } = paths!;
const plan = loadPlan(main);

const startId = val("start");
if (startId) {
  const w = findWp(plan, startId);
  if (!w) fail(`No work package ${startId}.`, 2);
  ledger(main, `STARTED ${w!.id}${val("agent") ? ` agent=${val("agent")}` : ""}`);
  console.log(`Recorded the start of WP-${w!.id}.`);
  process.exit(0);
}
const stopId = val("stop");
if (stopId) {
  const w = findWp(plan, stopId);
  if (!w) fail(`No work package ${stopId}.`, 2);
  ledger(main, `STOPPED ${w!.id}`);
  console.log(`WP-${w!.id} is no longer marked as started.`);
  process.exit(0);
}

// Latest STARTED/STOPPED/MERGED event per WP from the ledger.
const lastEvent = new Map<string, string>();
for (const line of ledgerLines(main)) {
  const m = /^\S+ (STARTED|STOPPED|MERGED|CLAIMED|REVERTED) (\S+)/.exec(line);
  if (m) lastEvent.set(m[2]!.toUpperCase(), m[1]!);
}

const wts = worktrees(main);
type State = "merged" | "merged+ahead" | "active" | "started" | "ready" | "blocked";
type Row = { id: string; title: string; wave: number; model: string; needs: string[]; priority: number; state: State; detail: string };

const merged = new Map<string, string>();
for (const w of plan.wps) { const sha = mergeCommit(main, w, "dev"); if (sha) merged.set(w.id, sha); }

const rows: Row[] = plan.wps.map((w: Wp) => {
  const exists = branchExists(main, w.branch);
  const ahead = exists ? Number(git(["rev-list", "--count", `dev..${w.branch}`], main).stdout.trim() || "0") : 0;
  const wt = wts.find((t) => t.branch === w.branch);
  const unmet = w.deps.filter((d) => !merged.has(d));
  const ev = lastEvent.get(w.id.toUpperCase());
  let state: State; let detail = "";
  if (merged.has(w.id)) {
    state = ahead > 0 ? "merged+ahead" : "merged";
    detail = `${merged.get(w.id)!.slice(0, 9)}${ahead ? ` · ${ahead} newer commits on ${w.branch}` : ""}`;
  } else if (exists) {
    state = "active";
    const last = git(["log", "-1", "--format=%cr", w.branch], main).stdout.trim();
    detail = `${ahead} commits · last ${last}${wt ? ` · ${wt.path}${wt.locked ? " (locked)" : ""}` : " · no worktree"}`;
  } else if (ev === "STARTED" || ev === "CLAIMED") {
    state = "started"; detail = "spawned, not claimed yet";
  } else if (unmet.length === 0) {
    state = "ready"; detail = w.needs.length ? `needs ${w.needs.join(", ")}` : "deps merged";
  } else {
    state = "blocked"; detail = `waits for ${unmet.join(", ")}`;
  }
  return { id: w.id, title: w.title, wave: w.wave, model: w.model, needs: w.needs, priority: w.priority, state, detail };
});

if (args.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else if (args.includes("--ready")) {
  for (const r of rows.filter((r) => r.state === "ready").sort((a, b) => b.priority - a.priority || a.wave - b.wave)) {
    console.log(`${r.id}\t${r.model}\tp${r.priority}\t${r.needs.length ? `needs:${r.needs.join(",")}` : "-"}\t${r.title}`);
  }
} else {
  const count = (s: State) => rows.filter((r) => r.state === s).length;
  console.log(`merged ${count("merged") + count("merged+ahead")} · active ${count("active")} · started ${count("started")} · ready ${count("ready")} · blocked ${count("blocked")} · total ${rows.length}\n`);
  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
  for (const r of [...rows].sort((a, b) => a.wave - b.wave || b.priority - a.priority)) {
    console.log(`${pad(r.id, 6)} ${pad(r.state, 13)} w${r.wave} ${pad(r.model, 7)} ${pad(r.title, 48)} ${r.detail}`);
  }
}
