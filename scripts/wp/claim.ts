#!/usr/bin/env bun
// Claim a work package inside the worktree Claude Code created for you: switch to the WP branch, check dependencies,
// install, link .handoff/, give you your own ports and, if your WP needs it, your own Lattice checkout.
// Usage (inside your worktree): bun scripts/wp/claim.ts <WP-ID> [--resume [--force]] [--no-install]
//   --resume takes over an existing branch: it commits anything the old worktree left uncommitted, then removes it.
//   --force  also takes over from a worktree that's still locked, which means its agent may be running. Only when
//            the orchestrator is sure that agent is gone.
// Exit codes: 0 claimed · 2 wrong place or unknown WP · 3 branch conflict · 4 dependencies · 5 install, checkout or lock failed
import { cpSync, existsSync, lstatSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  repoPaths, loadPlan, findWp, currentBranch, branchExists, git, gitOut, gitRetry, run, worktrees, mergeCommit, ledger,
  acquireLock, portSlot, fail, real,
} from "./lib.ts";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const resume = args.includes("--resume");
const force = args.includes("--force");
const noInstall = args.includes("--no-install");
if (!id) fail("Usage: bun scripts/wp/claim.ts <WP-ID> [--resume] [--no-install]", 2);

const paths = repoPaths(process.cwd());
if (!paths) fail("Not inside a git repository.", 2);
const { top, main, isWorktree, gitCommon } = paths!;
if (!isWorktree || real(top) === real(main)) {
  fail(`You're in the main checkout (${main}). WP agents work in their own worktree; the orchestrator spawns you with isolation: worktree.`, 2);
}

const plan = loadPlan(main, top);
const wp = findWp(plan, id!);
if (!wp) fail(`No work package ${id} in ${main}/.handoff/plan/wp.json.`, 2);
const W = wp!;
const tracked = () => gitOut(["status", "--porcelain", "--untracked-files=no"], top);

if (currentBranch(top) !== W.branch) {
  // Branch changes touch files every worktree shares, so they happen one claim at a time.
  const lock = await acquireLock(join(gitCommon, "wp-claim.lock"), `claim ${W.id}`, {}, 120_000)
    .catch((e) => fail(`Couldn't get the claim lock: ${String(e?.message ?? e)}\nNothing changed; run claim again.`, 5));
  try {
    if (branchExists(top, W.branch)) {
      if (!resume) fail(`Branch ${W.branch} already exists. If you're continuing that work, run again with --resume.`, 3);
      git(["worktree", "prune"], top);
      const holder = worktrees(top).find((w) => w.branch === W.branch && real(w.path) !== real(top));
      if (holder && existsSync(holder.path) && holder.locked && !force) {
        fail(`The old worktree ${holder.path} is locked: its agent may still be running. Report this to the orchestrator; only if that agent is gone, run claim again with --resume --force.`, 3);
      }
      if (holder && existsSync(holder.path)) {
        // Salvage anything the previous agent didn't commit, then free the branch.
        const dirty = git(["status", "--porcelain"], holder.path).stdout.trim();
        if (dirty) {
          git(["add", "-A"], holder.path);
          const c = git(["commit", "-q", "--no-verify", "-m", `wip(${W.id.toLowerCase()}): salvage uncommitted work`], holder.path);
          if (c.code !== 0) fail(`Couldn't salvage uncommitted work in ${holder.path}: ${c.stderr.trim()}`, 3);
          console.log(`Salvaged uncommitted work from ${holder.path} as a wip commit.`);
        }
        const rm = git(["worktree", "remove", "-f", "-f", holder.path], top); // -f -f also removes a stale lock and submodules
        if (rm.code !== 0) fail(`Couldn't remove the old worktree ${holder.path}: ${rm.stderr.trim()}`, 3);
      }
      if (tracked()) fail("Your worktree has uncommitted changes; can't take over the branch.", 3);
      await gitRetry(["checkout", "-q", "-B", W.branch, W.branch], top);
    } else {
      // Fresh claim. If the worktree started behind dev (baseRef misconfigured) and has no work yet, start from dev.
      const ahead = Number(gitOut(["rev-list", "--count", "dev..HEAD"], top));
      const behind = Number(gitOut(["rev-list", "--count", "HEAD..dev"], top));
      const base = behind > 0 && ahead === 0 && !tracked() ? "dev" : "HEAD";
      if (behind > 0 && base === "HEAD") console.warn(`Warning: your worktree is ${behind} commits behind dev and has work of its own.`);
      await gitRetry(["checkout", "-q", "-b", W.branch, base], top);
    }
  } finally { lock.release(); }
}

// Dependencies must be merged into dev and present in this branch's history.
const notMerged: string[] = [];
const notInBase: string[] = [];
for (const d of W.deps) {
  const dep = findWp(plan, d);
  const sha = dep ? mergeCommit(top, dep, "dev") : null;
  if (!sha) notMerged.push(d);
  else if (git(["merge-base", "--is-ancestor", sha, "HEAD"], top).code !== 0) notInBase.push(d);
}
if (notMerged.length) fail(`Dependencies not merged into dev yet: ${notMerged.join(", ")}. Report this to the orchestrator and stop.`, 4);
if (notInBase.length) fail(`Dependencies merged into dev after your worktree was made: ${notInBase.join(", ")}. Run \`git merge --no-edit dev\`, then claim again.`, 4);

// .handoff/ is gitignored. Link it to the main checkout's copy so you always read the orchestrator's latest plan.
const handoff = join(top, ".handoff");
const mainHandoff = join(main, ".handoff");
if (existsSync(mainHandoff)) {
  const isLink = existsSync(handoff) && lstatSync(handoff).isSymbolicLink();
  if (!isLink) {
    if (existsSync(handoff)) rmSync(handoff, { recursive: true, force: true });
    try { symlinkSync(mainHandoff, handoff, "dir"); } catch { cpSync(mainHandoff, handoff, { recursive: true }); }
  }
}

if (!noInstall) {
  const r = run(["bun", "install", "--frozen-lockfile"], top, { timeoutMs: 600_000 });
  if (r.code !== 0) fail(`bun install failed:\n${r.stderr.slice(-2000)}`, 5);
}

let latticeDir = join(main, "lattice");
if (W.needs.includes("lattice")) {
  latticeDir = join(top, "lattice");
  const empty = !existsSync(latticeDir) || readdirSync(latticeDir).length === 0;
  if (empty) {
    const lock = await acquireLock(join(gitCommon, "wp-submodule.lock"), `submodule for ${W.id}`, {}, 900_000)
      .catch((e) => fail(`Couldn't get the submodule lock: ${String(e?.message ?? e)}\nYour branch is set up; run claim again with --resume.`, 5));
    try {
      // Borrow objects from the main checkout's Lattice clone instead of fetching it all from GitHub again.
      const ref = existsSync(join(main, "lattice", ".git")) ? ["--reference", join(main, "lattice")] : [];
      const r = run(["git", "-c", "submodule.alternateErrorStrategy=info", "submodule", "update", "--init", "--recursive", ...ref],
        top, { timeoutMs: 900_000 });
      if (r.code !== 0) fail(`Couldn't check out the Lattice submodule:\n${r.stderr.slice(-2000)}`, 5);
    } finally { lock.release(); }
  }
}

const base = await portSlot(main, gitCommon, W.id, real(top));
const helperPorts = Array.from({ length: Math.min(W.helpers, 4) }, (_, i) => {
  const b = base + 4 * (i + 1);
  return `  helper ${i + 1}: STUDIO_PORT=${b} VITEST_BROWSER_PORT=${b + 1} PLAYWRIGHT_PORT=${b + 2} ANVIL_PORT_BASE=${b + 3}`;
});
writeFileSync(join(top, ".env.local"), [
  `# Written by scripts/wp/claim.ts for WP-${W.id}. Local only; gitignored.`,
  `STUDIO_PORT=${base}`,
  `VITEST_BROWSER_PORT=${base + 1}`,
  `PLAYWRIGHT_PORT=${base + 2}`,
  `ANVIL_PORT_BASE=${base + 3}`,
  `LATTICE_DIR=${latticeDir}`,
  `STUDIO_MAIN=${main}`,
  `STUDIO_WP=${W.id}`,
  "",
].join("\n"));

const sha = gitOut(["rev-parse", "--short", "HEAD"], top);
ledger(main, `CLAIMED ${W.id} ${sha} ${top}`);
console.log([
  `Claimed WP-${W.id} · ${W.title}`,
  `Branch ${W.branch} @ ${sha} in ${top}`,
  `Owns:\n${W.owns.map((g) => `  - ${g}`).join("\n")}`,
  `Brief: .handoff/${W.brief}`,
  `Merge gates: ${W.gates.join(", ")}`,
  `Ports: ${base}-${base + 3} are yours (see .env.local).`,
  ...(helperPorts.length ? ["Helper ports (give each helper its line; they prefix test commands with it):", ...helperPorts] : ["Helpers: none"]),
  ...(W.needs.includes("lattice") ? [`Lattice: your own checkout at ${latticeDir}; build it with FOUNDRY_PROFILE=ci forge build --root lattice`] : []),
].join("\n"));
