import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const wrapper = join(root, "scripts/dev/test-browser.ts");
const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

test("a browser filter matching no tests fails", () => {
  const result = Bun.spawnSync([
    process.execPath,
    wrapper,
    "apps/studio/src/__review_path_does_not_exist__.browser.test.ts",
  ], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).not.toBe(0);
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
  expect(output).toContain("No test files found");
}, 15_000);

test("a missing browser configuration fails with a stated reason", () => {
  const checkout = mkdtempSync(join(tmpdir(), "lattice-browser-wrapper-"));
  temporary.push(checkout);
  const folder = join(checkout, "scripts/dev");
  mkdirSync(folder, { recursive: true });
  const copied = join(folder, "test-browser.ts");
  copyFileSync(wrapper, copied);
  const result = Bun.spawnSync([process.execPath, copied], {
    cwd: checkout, stdout: "pipe", stderr: "pipe",
  });
  expect(result.exitCode).not.toBe(0);
  expect(new TextDecoder().decode(result.stderr)).toContain("Browser tests did not run");
});

type ResourceCase = {
  name: string; platform?: string; threshold?: string; blocks?: string; blockSize?: string;
  failure?: boolean; customTmp?: boolean; exit?: number; expected: string | null; reads: number;
};

function runResourceCase(options: ResourceCase) {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), "lattice-browser-resource-"))); temporary.push(checkout);
  const folder = join(checkout, "scripts/dev"), app = join(checkout, "apps/studio"), bin = join(checkout, "bin");
  for (const path of [folder, app, bin]) mkdirSync(path, { recursive: true });
  const copied = join(folder, "test-browser.ts"), child = join(checkout, "child.ts"), preload = join(checkout, "preload.ts");
  const calls = join(checkout, "statfs.jsonl"), nativeTmp = join(checkout, "native-tmp");
  copyFileSync(wrapper, copied); writeFileSync(join(app, "vitest.config.ts"), "");
  writeFileSync(child, `console.log(JSON.stringify({ threshold: process.env.VITEST_CHROMIUM_GC_DISK_THRESHOLD_GB ?? null, force: process.env.VITEST_CHROMIUM_GC_FORCE ?? null, args: process.argv.slice(2), cwd: process.cwd() })); process.exit(Number(process.env.LAUNCHER_TEST_EXIT));`);
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(join(bin, "bun"), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(child)} "$@"\n`); chmodSync(join(bin, "bun"), 0o755);
  writeFileSync(preload, `
    import { mock } from "bun:test";
    import * as filesystem from "node:fs";
    const real = { ...filesystem };
    Object.defineProperty(process, "platform", { value: process.env.LAUNCHER_TEST_PLATFORM });
    mock.module("node:fs", () => ({ ...real, statfsSync(path: string) {
      real.appendFileSync(process.env.LAUNCHER_TEST_CALLS!, JSON.stringify(path) + "\\n");
      if (process.env.LAUNCHER_TEST_FAILURE === "true") throw new Error("Controlled statfs failure");
      return { bavail: Number(process.env.LAUNCHER_TEST_BLOCKS), bsize: Number(process.env.LAUNCHER_TEST_BLOCK_SIZE) };
    } }));
  `);
  const env: Record<string, string | undefined> = {
    ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, LAUNCHER_TEST_PLATFORM: options.platform ?? "linux",
    LAUNCHER_TEST_CALLS: calls, LAUNCHER_TEST_BLOCKS: options.blocks ?? "34359738368", LAUNCHER_TEST_BLOCK_SIZE: options.blockSize ?? "1",
    LAUNCHER_TEST_FAILURE: String(options.failure ?? false), LAUNCHER_TEST_EXIT: String(options.exit ?? 0),
    TMP: join(checkout, "other-tmp"), TEMP: join(checkout, "other-temp"),
  };
  delete env.STUDIO_BROWSER_DIAGNOSTICS_DIR; delete env.VITEST_CHROMIUM_GC_DISK_THRESHOLD_GB; delete env.VITEST_CHROMIUM_GC_FORCE; delete env.TMPDIR;
  if (options.threshold !== undefined) env.VITEST_CHROMIUM_GC_DISK_THRESHOLD_GB = options.threshold;
  if (options.customTmp) env.TMPDIR = nativeTmp;
  const result = Bun.spawnSync([process.execPath, "--preload", preload, copied, "apps/studio/src/ui", "--reporter=json"], { cwd: checkout, stdout: "pipe", stderr: "pipe", env });
  expect(result.stderr.toString()).toBe("");
  const capture: unknown = JSON.parse(result.stdout.toString());
  const measurements: unknown[] = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line) as unknown) : [];
  return { result, capture, measurements, app, measuredPath: options.customTmp ? nativeTmp : "/tmp" };
}

describe("native resource budget", () => {
  const cases: ResourceCase[] = [
    { name: "Linux 4 GiB growth budget", expected: "28", reads: 1 },
    { name: "ordinary filesystem geometry", blocks: "8388608", blockSize: "4096", expected: "28", reads: 1 },
    { name: "fractional available space", blocks: "34896609280", expected: "28.5", reads: 1 },
    { name: "4 GiB minimum threshold", blocks: "6442450944", expected: "4", reads: 1 },
    { name: "zero available space", blocks: "0", expected: "4", reads: 1 },
    { name: "Vitest TMPDIR selection", customTmp: true, expected: "28", reads: 1 },
    { name: "Mac leaves the environment unchanged", platform: "darwin", expected: null, reads: 0 },
    { name: "explicit empty override", threshold: "", expected: "", reads: 0 },
    { name: "explicit zero override", threshold: "0", expected: "0", reads: 0 },
    { name: "explicit numeric override", threshold: "17", expected: "17", reads: 0 },
    { name: "explicit other string override", threshold: "custom", expected: "custom", reads: 0 },
    { name: "failed measurement keeps the default", failure: true, expected: null, reads: 1 },
    { name: "negative available blocks keep the default", blocks: "-1", expected: null, reads: 1 },
    { name: "invalid available blocks keep the default", blocks: "NaN", expected: null, reads: 1 },
    { name: "overflowed space keeps the default", blocks: "1e308", blockSize: "4096", expected: null, reads: 1 },
    { name: "invalid block size keeps the default", blockSize: "0", expected: null, reads: 1 },
    { name: "child exit status is preserved", exit: 23, expected: "28", reads: 1 },
  ];
  test.each(cases)("$name", (options) => {
    const { result, capture, measurements, app, measuredPath } = runResourceCase(options);
    expect(result.exitCode).toBe(options.exit ?? 0);
    expect(capture).toEqual({ threshold: options.expected, force: null, args: ["x", "vitest", "run", "src/ui", "--reporter=json"], cwd: app });
    expect(measurements).toEqual(options.reads ? [measuredPath] : []);
  });
});
