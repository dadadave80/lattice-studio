// Shared helpers for the work-package tooling (claim, merge, status, plan-check, add-wp) and the Claude Code hooks.
// Orchestrator-owned: WP agents never edit this folder.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { spawn } from "node:child_process";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export type Wp = {
  id: string; title: string; wave: number; model: string; review: string; branch: string;
  deps: string[]; owns: string[]; needs: string[]; gates: string[]; helpers: number; priority: number; brief: string;
};
export type Plan = {
  version: number; protected: string[]; frozenBy: Record<string, string[]>;
  gates: Record<string, string[]>; wps: Wp[];
};
export const REQUIRED_FIELDS = ["id", "title", "wave", "model", "review", "branch", "deps", "owns", "gates", "brief"] as const;

export type Run = { code: number; stdout: string; stderr: string };

export function run(cmd: string[], cwd: string, opts: { env?: Record<string, string>; timeoutMs?: number } = {}): Run {
  const p = Bun.spawnSync(cmd, {
    cwd,
    env: { ...process.env, ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
    ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
  });
  return {
    code: p.exitCode ?? (p.signalCode ? 124 : 1),
    stdout: p.stdout ? new TextDecoder().decode(p.stdout) : "",
    stderr: p.stderr ? new TextDecoder().decode(p.stderr) : "",
  };
}

/**
 * Like run(), but async and in its own process group, so a signal handler (merge.ts) or a timeout can kill the whole
 * tree: a gate's test runner, the dev server it started and the browsers it launched.
 */
export function runAsync(cmd: string[], cwd: string, opts: { env?: Record<string, string>; timeoutMs?: number; onSpawn?: (kill: () => void) => void } = {}): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { cwd, env: { ...process.env, ...opts.env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    const killTree = () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } };
    opts.onSpawn?.(killTree);
    let timedOut = false;
    const timer = opts.timeoutMs ? setTimeout(() => { timedOut = true; killTree(); }, opts.timeoutMs) : null;
    child.on("error", (e) => { if (timer) clearTimeout(timer); done({ code: 127, stdout, stderr: `${stderr}\n${String(e)}` }); });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      done({ code: timedOut ? 124 : (code ?? 1), stdout, stderr: timedOut ? `${stderr}\n[timed out after ${opts.timeoutMs} ms]` : stderr });
    });
  });
}

export function git(args: string[], cwd: string): Run {
  return run(["git", ...args], cwd);
}

export function gitOut(args: string[], cwd: string): string {
  const r = git(args, cwd);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

/** Git writes that touch shared files (.git/config, packed-refs) can collide when many agents claim at once: retry. */
export async function gitRetry(args: string[], cwd: string, tries = 8): Promise<string> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    const r = git(args, cwd);
    if (r.code === 0) return r.stdout.trim();
    last = r.stderr.trim();
    if (!/lock|unable to create|could not lock|File exists|tmp-renamed-log/i.test(last)) break;
    await Bun.sleep(150 + Math.random() * 400 * (i + 1));
  }
  throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${last}`);
}

export type RepoPaths = { top: string; main: string; isWorktree: boolean; gitCommon: string };

/** Worktree root of `cwd`, the main checkout, and whether `cwd` is inside a linked worktree. */
export function repoPaths(cwd: string): RepoPaths | null {
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  if (top.code !== 0) return null;
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  const gitDir = git(["rev-parse", "--path-format=absolute", "--git-dir"], cwd);
  if (common.code !== 0 || gitDir.code !== 0) return null;
  const commonDir = common.stdout.trim();
  const main = basename(commonDir) === ".git" ? dirname(commonDir) : top.stdout.trim();
  return { top: top.stdout.trim(), main, isWorktree: gitDir.stdout.trim() !== commonDir, gitCommon: commonDir };
}

export function real(p: string): string {
  // realpath of the path, or of its nearest existing parent joined with the rest (for files not created yet)
  let cur = resolve(p);
  const rest: string[] = [];
  while (!existsSync(cur) && dirname(cur) !== cur) { rest.unshift(basename(cur)); cur = dirname(cur); }
  try { return join(realpathSync(cur), ...rest); } catch { return resolve(p); }
}

export function planPath(main: string): string {
  return join(main, ".handoff", "plan", "wp.json");
}

export function loadPlan(main: string, fallbackTop?: string): Plan {
  const candidates = [planPath(main), ...(fallbackTop ? [planPath(fallbackTop)] : [])];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const plan = JSON.parse(readFileSync(p, "utf8")) as Plan;
    for (const w of plan.wps) {
      w.needs ??= []; w.helpers ??= 0; w.deps ??= []; w.gates ??= ["typecheck", "lint", "test"];
      w.priority ??= 1; w.review ??= w.model ?? "opus"; w.title ??= w.id;
      w.branch ??= `feat/wp-${w.id.toLowerCase()}`; w.brief ??= `plan/wp/${w.id}.md`;
    }
    return plan;
  }
  throw new Error(`No plan at ${candidates.join(" or ")}. Is .handoff/ in place?`);
}

export function findWp(plan: Plan, id: string): Wp | undefined {
  const want = id.replace(/^WP-/i, "").toLowerCase();
  return plan.wps.find((w) => w.id.toLowerCase() === want);
}

const BRANCH_RE = /^(?:feat|fix|test|docs|chore)\/wp-([a-z0-9]+)$/i;
export function wpIdFromBranch(branch: string): string | null {
  const m = BRANCH_RE.exec(branch.trim());
  return m ? m[1]! : null;
}

export function currentBranch(cwd: string): string {
  return git(["branch", "--show-current"], cwd).stdout.trim();
}

export function matchesAny(globs: string[], rel: string): boolean {
  return globs.some((g) => g === rel || new Bun.Glob(g).match(rel));
}

/** Whether `wp` may write repo-relative path `rel` (owned and not protected, with the K1/K2 frozen-file exception). */
export function mayWrite(plan: Plan, wp: Wp, rel: string): { ok: true } | { ok: false; reason: "protected" | "not-owned" } {
  const frozenOwn = plan.frozenBy[wp.id] ?? [];
  if (matchesAny(frozenOwn, rel)) return { ok: true };
  if (matchesAny(plan.protected, rel)) return { ok: false, reason: "protected" };
  if (matchesAny(wp.owns, rel)) return { ok: true };
  return { ok: false, reason: "not-owned" };
}

export function toRel(root: string, file: string, cwd: string): string {
  return relative(real(root), real(resolve(cwd, file))).split(sep).join("/");
}

export function ledger(main: string, line: string): void {
  const dir = join(main, ".handoff");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "ledger.log"), `${new Date().toISOString()} ${line}\n`);
}

export function ledgerLines(main: string): string[] {
  const p = join(main, ".handoff", "ledger.log");
  return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean) : [];
}

export function branchExists(cwd: string, branch: string): boolean {
  return git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], cwd).code === 0;
}

export function mergeSubject(wp: Wp): string {
  return `merge(wp-${wp.id.toLowerCase()}): ${wp.title}`;
}

export const mergedRef = (wp: Wp) => `refs/wp/merged/${wp.id.toLowerCase()}`;

/**
 * The merge commit for this WP, if it passed its gates and is still part of `into`.
 * merge.ts writes refs/wp/merged/<id> only after the gates pass, and --revert deletes it.
 */
export function mergeCommit(cwd: string, wp: Wp, into = "dev"): string | null {
  const r = git(["rev-parse", "--verify", "--quiet", `${mergedRef(wp)}^{commit}`], cwd);
  const sha = r.code === 0 ? r.stdout.trim() : "";
  if (!sha) return null;
  return git(["merge-base", "--is-ancestor", sha, into], cwd).code === 0 ? sha : null;
}

export function wpMerged(cwd: string, wp: Wp, into = "dev"): boolean {
  return mergeCommit(cwd, wp, into) !== null;
}

export type WorktreeInfo = { path: string; branch: string | null; head: string; locked: boolean; prunable: boolean };
export function worktrees(cwd: string): WorktreeInfo[] {
  const out = gitOut(["worktree", "list", "--porcelain"], cwd);
  const list: WorktreeInfo[] = [];
  let cur: WorktreeInfo | null = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) { if (cur) list.push(cur); cur = { path: line.slice(9), branch: null, head: "", locked: false, prunable: false }; }
    else if (!cur) continue;
    else if (line.startsWith("HEAD ")) cur.head = line.slice(5);
    else if (line.startsWith("branch ")) cur.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (line.startsWith("locked")) cur.locked = true;
    else if (line.startsWith("prunable")) cur.prunable = true;
  }
  if (cur) list.push(cur);
  return list;
}

export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as { code?: string }).code === "EPERM"; }
}

export type LockInfo = { pid: number; what: string; at: string; [k: string]: unknown };

/** An exclusive lock file holding its owner's pid. A lock whose pid is dead is stale and taken over. */
export async function acquireLock(path: string, what: string, extra: Record<string, unknown> = {}, waitMs = 60_000): Promise<{ release: () => void; stale: LockInfo | null }> {
  const t0 = Date.now();
  let stale: LockInfo | null = null;
  for (;;) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, what, at: new Date().toISOString(), ...extra }));
      closeSync(fd);
      let released = false;
      return { stale, release: () => { if (!released) { released = true; rmSync(path, { force: true }); } } };
    } catch {
      let info: LockInfo | null = null;
      try { info = JSON.parse(readFileSync(path, "utf8")) as LockInfo; } catch { /* half-written */ }
      if (info && !pidAlive(info.pid)) { stale = info; rmSync(path, { force: true }); continue; }
      if (!info && Date.now() - t0 > 5_000) { rmSync(path, { force: true }); continue; }
      if (Date.now() - t0 > waitMs) throw new Error(`Timed out waiting for ${path} (held by ${info ? `pid ${info.pid}, ${info.what}` : "unknown"}).`);
      await Bun.sleep(200 + Math.random() * 300);
    }
  }
}

// Port slots: blocks of 20 ports from 20000, handed out under a lock so concurrent WPs never share one.
// Slot 0 is reserved for merge gates. A slot is free once its worktree no longer exists.
export const PORTS_PER_SLOT = 20;
export async function portSlot(main: string, gitCommon: string, key: string, worktreePath: string): Promise<number> {
  const file = join(gitCommon, "wp-ports.json");
  const lock = await acquireLock(join(gitCommon, "wp-ports.lock"), `ports for ${key}`, {}, 30_000);
  try {
    const table: Record<string, { key: string; path: string }> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    for (const [slot, v] of Object.entries(table)) if (!existsSync(v.path)) delete table[slot];
    let slot = Object.entries(table).find(([, v]) => v.path === worktreePath)?.[0];
    if (!slot) {
      for (let s = 1; s < 199; s++) if (!table[String(s)]) { slot = String(s); break; }
      if (!slot) throw new Error("No free port slot (198 in use).");
      table[slot] = { key, path: worktreePath };
    }
    writeFileSync(file, JSON.stringify(table, null, 2));
    return 20000 + Number(slot) * PORTS_PER_SLOT;
  } finally { lock.release(); }
}
export const GATE_PORT_BASE = 20000; // slot 0

export function fail(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}
