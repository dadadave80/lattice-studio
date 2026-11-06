import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupTimings } from "./setup-metrics.ts";

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

test("records elapsed and substage seconds without inventing timings for skipped stages", () => {
  expect(setupTimings({ SETUP_STARTED_MS: "1000", SETUP_INSTALL_SECONDS: "2", SETUP_APT_SECONDS: "17", SETUP_BROWSER_SECONDS: "0" }, 22500)).toEqual({
    total: 21.5, frozenInstall: 2, apt: 17, browserDownload: 0,
  });
  expect(setupTimings({ SETUP_STARTED_MS: "1000", SETUP_INSTALL_SECONDS: "2" }, 4000)).toEqual({ total: 3, frozenInstall: 2, apt: null, browserDownload: null });
});

test("rejects missing, malformed and negative timings instead of reporting a false fast setup", () => {
  expect(setupTimings({ SETUP_STARTED_MS: "invalid", SETUP_INSTALL_SECONDS: "", SETUP_APT_SECONDS: "-1", SETUP_BROWSER_SECONDS: "NaN" }, 1000)).toEqual({ total: null, frozenInstall: null, apt: null, browserDownload: null });
  expect(setupTimings({ SETUP_STARTED_MS: "2000" }, 1000).total).toBeNull();
});

test.each(["success", "failure"])("CLI distinguishes a %s cache restore and never records unrelated secrets", (outcome) => {
  const root = mkdtempSync(join(tmpdir(), "studio-setup-metrics-")); temporary.push(root);
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "setup-metrics.ts")], {
    cwd: join(import.meta.dir, "..", ".."),
    env: { ...process.env, RUNNER_TEMP: root, GITHUB_OUTPUT: join(root, "outputs"), GITHUB_STEP_SUMMARY: join(root, "summary"), SETUP_BROWSERS: "chromium", SETUP_CACHE_OUTCOME: outcome, SETUP_CACHE_HIT: "true", SETUP_APT_MIRROR: "ubuntu-archive", SETUP_MIRROR_OUTCOME: "failure", SETUP_MIRROR_STATE: "", SECRET_RPC_URL: "https://private.test/?key=never-record-this" },
    stdout: "pipe", stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  const text = readFileSync(join(root, "studio-setup-metrics.json"), "utf8");
  const data: unknown = JSON.parse(text);
  expect(data).toMatchObject({ playwright: { cacheHit: outcome === "success" ? true : null }, aptMirror: { state: "not-completed" } });
  expect(text).not.toContain("never-record-this");
  expect(result.stdout.toString()).not.toContain("never-record-this");
});
