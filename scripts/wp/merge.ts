#!/usr/bin/env bun
// Land a finished work package on local `dev`, only if it stayed inside its scope and its gates pass.
// The merge and the gates run in a separate integration worktree (.integration/); `dev` in the main checkout
// fast-forwards only after every gate is green. So a failed, interrupted or killed merge never touches `dev`,
// and new WP worktrees (which branch from the main checkout's HEAD) never start from untested code.
// Orchestrator only; run from the main checkout on `dev`. Safe to run in the background.
//
//   bun scripts/wp/merge.ts <WP-ID>                  scope check, merge in .integration, gates, fast-forward dev
//   bun scripts/wp/merge.ts <WP-ID> --check          scope and dependency check only
//   bun scripts/wp/merge.ts <WP-ID> --gates=a,b      run these gates instead of the WP's own
//   bun scripts/wp/merge.ts <WP-ID> --no-gates       land without gates (write why in the ledger yourself)
//   bun scripts/wp/merge.ts <WP-ID> --keep-worktree  keep the WP's worktree afterwards
//   bun scripts/wp/merge.ts <WP-ID> --revert         undo this WP's merge on dev with a revert commit
//   bun scripts/wp/merge.ts --prepare                create or refresh .integration (BOOT does this once)
// Exit codes: 0 landed, reverted or check passed · 2 usage, repo state, a busy lock or a failed revert · 3 out of scope
//             4 dependencies · 5 merge conflict · 6 a gate failed · 7 dev moved while the gates ran (run it again)
//             130 interrupted
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  repoPaths, loadPlan, findWp, currentBranch, branchExists, git, gitOut, run, runAsync, worktrees, mergeCommit, mergeSubject,
  mergedRef, mayWrite, ledger, acquireLock, fail, real, GATE_PORT_BASE, type Wp, type Plan,
} from "./lib.ts";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const paths = repoPaths(process.cwd());
if (!paths) fail("Not inside a git repository.", 2);
const { top, main, gitCommon } = paths!;
if (real(top) !== real(main)) fail(`Run merge.ts from the main checkout (${main}), not a worktree.`, 2);
if (currentBranch(main) !== "dev") fail("The main checkout must be on `dev`.", 2);
const integ = join(main, ".integration");

let killChild: (() => void) | null = null;
let releaseLock: () => void = () => {};
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    killChild?.();
    releaseLock();
    console.error(`Interrupted (${sig}). dev is untouched; .integration is reset on the next run.`);
    process.exit(130);
  });
}

const lock = await acquireLock(join(gitCommon, "wp-merge.lock"), `merge ${id ?? "--prepare"}`, {}, 5_000).catch((e) => fail(String(e.message ?? e), 2));
releaseLock = lock.release;
process.on("exit", () => releaseLock());
if (lock.stale) console.log(`Took over a stale merge lock from pid ${lock.stale.pid} (${lock.stale.what}).`);

if (flag("prepare")) { await prepare(); process.exit(0); }
if (!id) fail("Usage: bun scripts/wp/merge.ts <WP-ID> [--check|--revert|--no-gates|--gates=a,b|--keep-worktree] | --prepare", 2);
const plan: Plan = loadPlan(main);
const W = findWp(plan, id!) as Wp;
if (!W) fail(`No work package ${id}.`, 2);

try {
  if (flag("revert")) revert();
  else await land();
} catch (e) {
  // gitOut and friends throw on unexpected git failures; report them as a repo-state problem, never a bare crash.
  fail(`merge.ts failed: ${String((e as Error)?.message ?? e).trim()}\nIf .integration/ looks broken, run \`bun scripts/wp/merge.ts --prepare\`, then try again.`, 2);
}

// ─────────────────────────────────────────────────────────────────────────────

async function prepare(): Promise<void> {
  git(["worktree", "prune"], main);
  if (!worktrees(main).some((w) => real(w.path) === real(integ))) {
    const r = git(["worktree", "add", "--detach", integ, "dev"], main);
    if (r.code !== 0) fail(`Couldn't create ${integ}: ${r.stderr.trim()}`, 2);
  }
  gitOut(["checkout", "-q", "--detach", "--force", "dev"], integ);
  gitOut(["reset", "-q", "--hard", "dev"], integ);
  git(["clean", "-q", "-fd", "-e", "lattice"], integ);
  const lat = join(integ, "lattice");
  if (!existsSync(lat) || readdirSync(lat).length === 0) {
    const ref = existsSync(join(main, "lattice", ".git")) ? ["--reference", join(main, "lattice")] : [];
    const r = run(["git", "-c", "submodule.alternateErrorStrategy=info", "submodule", "update", "--init", "--recursive", ...ref],
      integ, { timeoutMs: 900_000 });
    if (r.code !== 0) console.warn(`Couldn't check out Lattice in ${integ} (golden and chain gates need it):\n${r.stderr.slice(-800)}`);
  } else {
    git(["submodule", "update", "--recursive"], integ);
  }
  const i = run(["bun", "install", "--frozen-lockfile"], integ, { timeoutMs: 600_000 });
  if (i.code !== 0) fail(`bun install failed in ${integ}:\n${i.stderr.slice(-1500)}`, 2);
  console.log(`${integ} is at dev ${gitOut(["rev-parse", "--short", "HEAD"], integ)}.`);
}

function revert(): void {
  const sha = mergeCommit(main, W, "dev");
  if (!sha) fail(`WP-${W.id} has no landed merge on dev.`, 2);
  if (gitOut(["status", "--porcelain", "--untracked-files=no"], main)) fail("The main checkout has uncommitted changes.", 2);
  // Always a new commit, never a reset: worktrees made since the merge already contain it, and rewriting dev under
  // them would push their next merge out of scope.
  const r = git(["revert", "--no-edit", "-m", "1", sha!], main);
  if (r.code !== 0) { git(["revert", "--abort"], main); fail(`Couldn't revert ${sha}: ${r.stderr.trim()}\nResolve it by hand on dev, or revert the later WPs that build on it first.`, 2); }
  const rev = gitOut(["rev-parse", "--short", "HEAD"], main);
  console.log(`Reverted the merge of WP-${W.id} (${sha!.slice(0, 9)}) with commit ${rev}. To re-land, the implementer runs \`git merge --no-edit dev\`, then \`git revert --no-edit ${rev}\` on its branch, fixes it, and you merge it again.`);
  git(["update-ref", "-d", mergedRef(W)], main);
  ledger(main, `REVERTED ${W.id} ${sha}`);
}

async function land(): Promise<void> {
  if (gitOut(["status", "--porcelain", "--untracked-files=no"], main)) fail("The main checkout has uncommitted changes; commit or stash them before merging.", 2);
  if (!branchExists(main, W.branch)) fail(`Branch ${W.branch} doesn't exist. Has WP-${W.id} been claimed?`, 2);
  const ahead = Number(gitOut(["rev-list", "--count", `dev..${W.branch}`], main));
  if (ahead === 0) fail(`${W.branch} has nothing that isn't already on dev.`, 2);

  const deps = W.deps.filter((d) => { const dep = findWp(plan, d); return !dep || !mergeCommit(main, dep, "dev"); });
  if (deps.length) fail(`Dependencies not merged yet: ${deps.join(", ")}.`, 4);

  // Scope: every path the branch adds, changes, renames or deletes since it left dev.
  const base = gitOut(["merge-base", "dev", W.branch], main);
  const touched = new Set<string>();
  for (const line of gitOut(["diff", "--name-status", "-M", base, W.branch], main).split("\n").filter(Boolean)) {
    for (const p of line.split("\t").slice(1)) touched.add(p);
  }
  const bad = [...touched].flatMap((f) => { const v = mayWrite(plan, W, f); return v.ok ? [] : [`${f} (${v.reason === "protected" ? "protected" : "not owned"})`]; });
  if (bad.length) fail(`WP-${W.id} changed files outside its scope:\n  ${bad.join("\n  ")}\nOwned: ${W.owns.join(", ")}\nSend it back, or apply those changes yourself as a CCR.`, 3);
  console.log(`Scope OK: ${touched.size} files, ${ahead} commits.`);
  if (flag("check")) return;

  // Merge in the integration worktree.
  await prepare();
  const devSha = gitOut(["rev-parse", "HEAD"], integ);
  const m = git(["merge", "--no-ff", "--no-edit", "-m", mergeSubject(W), W.branch], integ);
  if (m.code !== 0) {
    const conflicts = git(["diff", "--name-only", "--diff-filter=U"], integ).stdout.trim();
    git(["merge", "--abort"], integ);
    if (conflicts) fail(`Merge conflict with dev in:\n${conflicts}\nAsk the implementer to run \`git merge --no-edit dev\`, resolve, commit and report again.`, 5);
    fail(`git merge failed (not a conflict):\n${m.stderr.trim()}`, 2);
  }
  const sha = gitOut(["rev-parse", "HEAD"], integ);
  console.log(`Merged ${W.branch} in .integration as ${sha.slice(0, 9)}. Running gates…`);

  const logs = join(main, ".handoff", "logs");
  if (!existsSync(logs)) mkdirSync(logs, { recursive: true });
  const gates = flag("no-gates") ? [] : (opt("gates")?.split(",").filter(Boolean) ?? W.gates);
  const install = run(["bun", "install", "--frozen-lockfile"], integ, { timeoutMs: 600_000 });
  if (install.code !== 0) {
    writeFileSync(join(logs, `merge-${W.id}-install.log`), `$ bun install --frozen-lockfile\n\n${install.stdout}\n${install.stderr}`);
    gateFailed("install", install.stdout + install.stderr, join(logs, `merge-${W.id}-install.log`));
  }
  const TIMEOUT: Record<string, number> = { typecheck: 600, lint: 300, test: 1200, browser: 2400, e2e: 3600, golden: 1800, chain: 1800, size: 900 };
  const gateEnv = {
    CI: "1", STUDIO_PORT: String(GATE_PORT_BASE), VITEST_BROWSER_PORT: String(GATE_PORT_BASE + 1),
    PLAYWRIGHT_PORT: String(GATE_PORT_BASE + 2), ANVIL_PORT_BASE: String(GATE_PORT_BASE + 3),
    LATTICE_DIR: join(integ, "lattice"), STUDIO_MAIN: main, STUDIO_WP: `merge-${W.id}`,
  };
  const passed: string[] = [];
  for (const g of gates) {
    const cmd = plan.gates[g];
    if (!cmd) fail(`Unknown gate ${g}.`, 2);
    let full = [...cmd!];
    if (g === "browser") {
      const dirs = testDirs([...touched], "browser");
      if (!dirs.length) { console.log("browser: skipped (no app code changed)"); continue; }
      full = [...full, ...dirs];
    }
    if (g === "e2e") {
      const dirs = testDirs([...touched], "e2e");
      if (!dirs.length) { console.log("e2e: skipped (no specs changed)"); continue; }
      full = [...full, ...dirs];
    }
    const t0 = Date.now();
    const r = await runAsync(full, integ, { timeoutMs: (TIMEOUT[g] ?? 1200) * 1000, env: gateEnv, onSpawn: (k) => { killChild = k; } });
    killChild = null;
    writeFileSync(join(logs, `merge-${W.id}-${g}.log`), `$ ${full.join(" ")}\n\n${r.stdout}\n${r.stderr}`);
    if (r.code !== 0) gateFailed(g, `${r.stdout}\n${r.stderr}`, join(logs, `merge-${W.id}-${g}.log`));
    console.log(`${g}: passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    passed.push(g);
  }

  // Land: fast-forward dev in the main checkout to the tested merge.
  const nowDev = gitOut(["rev-parse", "dev"], main);
  if (nowDev !== devSha) fail(`dev moved while the gates ran (${devSha.slice(0, 9)} → ${nowDev.slice(0, 9)}). Nothing landed; run merge.ts ${W.id} again.`, 7);
  if (gitOut(["status", "--porcelain", "--untracked-files=no"], main)) fail("The main checkout picked up uncommitted changes while the gates ran; nothing landed.", 2);
  const ff = git(["merge", "--ff-only", "-q", sha], main);
  if (ff.code !== 0) fail(`Couldn't fast-forward dev: ${ff.stderr.trim()}`, 2);
  gitOut(["update-ref", mergedRef(W), sha], main);
  ledger(main, `MERGED ${W.id} ${sha} gates=${passed.join(",") || "none"}`);

  if (!flag("keep-worktree")) {
    const wt = worktrees(main).find((w) => w.branch === W.branch);
    if (wt && real(wt.path) !== real(main) && existsSync(wt.path)) {
      const dirty = git(["status", "--porcelain"], wt.path).stdout.trim();
      if (dirty) console.log(`Kept worktree ${wt.path}: it has uncommitted changes.`);
      else if (git(["worktree", "remove", "--force", wt.path], main).code === 0) console.log(`Removed worktree ${wt.path}.`);
      else console.log(`Kept worktree ${wt.path}: it's locked (its agent may still be running).`);
    }
  }
  console.log(`WP-${W.id} landed on dev at ${sha.slice(0, 9)}.`);
}

function gateFailed(gate: string, output: string, log?: string): never {
  ledger(main, `GATE-FAILED ${W.id} ${gate}`);
  const tail = output.split("\n").slice(-60).join("\n");
  fail(`Gate "${gate}" failed. Nothing landed; dev is unchanged.${log ? `\nFull log: ${log}` : ""}\n--- last lines ---\n${tail}`, 6);
}

/**
 * Test folders to run for the files a WP touched:
 *   browser: module folders under apps/studio/src (apps/studio/src/panels/console), apps/studio/test/browser, plus the app smoke test
 *   e2e: spec folders under apps/studio/e2e (apps/studio/e2e/q1a)
 */
function testDirs(files: string[], kind: "browser" | "e2e"): string[] {
  const out = new Set<string>();
  const nested = new Set(["sheet", "panels", "chain"]);
  for (const f of files) {
    if (kind === "browser") {
      if (f.startsWith("apps/studio/src/")) {
        const parts = f.slice("apps/studio/src/".length).split("/");
        if (parts.length < 2) { out.add("apps/studio/src/app"); continue; }
        const depth = nested.has(parts[0]!) && parts.length > 2 ? 2 : 1;
        out.add("apps/studio/src/" + parts.slice(0, depth).join("/"));
      } else if (f.startsWith("apps/studio/test/browser/")) out.add("apps/studio/test/browser");
      else if (f.startsWith("apps/studio/")) out.add("apps/studio/src/app");
    } else if (f.startsWith("apps/studio/e2e/")) {
      const parts = f.slice("apps/studio/e2e/".length).split("/");
      if (parts.length >= 2) out.add("apps/studio/e2e/" + parts[0]);
    }
  }
  if (kind === "browser" && out.size) out.add("apps/studio/src/app");
  return [...out];
}
