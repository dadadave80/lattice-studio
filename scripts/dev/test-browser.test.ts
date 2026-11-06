import { afterEach, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
