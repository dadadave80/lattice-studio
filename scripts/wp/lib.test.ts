import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, mayWrite, wpIdFromBranch, matchesAny, type Plan, type Wp } from "./lib.ts";

const wp = (id: string, owns: string[]): Wp => ({
  id, title: id, wave: 1, model: "opus", review: "opus", branch: `feat/wp-${id.toLowerCase()}`,
  deps: [], owns, needs: [], gates: [], helpers: 0, priority: 1, brief: `plan/wp/${id}.md`,
});
const plan: Plan = {
  version: 1,
  protected: ["**/package.json", "packages/core/src/model/**", ".claude/**"],
  frozenBy: { K1: ["packages/core/src/model/**"] },
  gates: {},
  wps: [],
};

describe("work-package tooling", () => {
  test("branch names map to WP ids", () => {
    expect(wpIdFromBranch("feat/wp-c2")).toBe("c2");
    expect(wpIdFromBranch("fix/wp-fx3")).toBe("fx3");
    expect(wpIdFromBranch("feat/c2-routing")).toBeNull();
    expect(wpIdFromBranch("worktree-agent-1")).toBeNull();
  });

  test("owners write their paths, never protected ones", () => {
    const c2 = wp("C2", ["packages/core/src/analysis/**", "packages/core/src/checks/sel.ts"]);
    expect(mayWrite(plan, c2, "packages/core/src/analysis/routing.ts")).toEqual({ ok: true });
    expect(mayWrite(plan, c2, "packages/core/src/checks/sel.ts")).toEqual({ ok: true });
    expect(mayWrite(plan, c2, "packages/core/src/checks/sem.ts")).toEqual({ ok: false, reason: "not-owned" });
    expect(mayWrite(plan, c2, "packages/core/package.json")).toEqual({ ok: false, reason: "protected" });
    expect(mayWrite(plan, c2, "packages/core/src/model/recipe.ts")).toEqual({ ok: false, reason: "protected" });
  });

  test("the WP that creates a frozen contract may write it", () => {
    const k1 = wp("K1", ["packages/core/src/**"]);
    expect(mayWrite(plan, k1, "packages/core/src/model/recipe.ts")).toEqual({ ok: true });
    expect(mayWrite(plan, k1, ".claude/settings.json")).toEqual({ ok: false, reason: "protected" });
  });

  test("globs", () => {
    expect(matchesAny(["apps/studio/src/ui/**"], "apps/studio/src/ui/Button.tsx")).toBe(true);
    expect(matchesAny(["apps/studio/src/ui/**"], "apps/studio/src/uix/Button.tsx")).toBe(false);
  });

  test("locks exclude each other and a dead owner's lock is taken over", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wp-lock-"));
    const path = join(dir, "x.lock");
    const a = await acquireLock(path, "a");
    await expect(acquireLock(path, "b", {}, 300)).rejects.toThrow(/Timed out/);
    a.release();
    expect(existsSync(path)).toBe(false);
    await Bun.write(path, JSON.stringify({ pid: 999999, what: "dead", at: "" }));
    const c = await acquireLock(path, "c", {}, 1000);
    expect(c.stale?.what).toBe("dead");
    c.release();
  });
});
