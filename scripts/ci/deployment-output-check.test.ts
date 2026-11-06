import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyDeploymentOutput } from "./deployment-output-check.ts";

const scratch = mkdtempSync(join(tmpdir(), "studio-deployment-check-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function fixture(name: string, html: string): string {
  const dist = join(scratch, name);
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), html);
  writeFileSync(join(dist, "assets", "previous-abc.js"), "export const previous = true;");
  return dist;
}

describe("deployment output verification", () => {
  test("checks generated deployment headers without changing the production build or carried assets", () => {
    const html = '<html><head><style>body{margin:0}</style></head><body><script type="importmap">{"imports":{}}</script></body></html>';
    const dist = fixture("valid", html);
    expect(() => verifyDeploymentOutput(dist)).not.toThrow();
    expect(readFileSync(join(dist, "index.html"), "utf8")).toBe(html);
    expect(readFileSync(join(dist, "assets", "previous-abc.js"), "utf8")).toBe("export const previous = true;");
  });

  test("refuses markup that the hash-only security policy cannot allow", () => {
    const dist = fixture("unsafe", '<html><body><button onclick="alert(1)">Test</button></body></html>');
    expect(() => verifyDeploymentOutput(dist)).toThrow("onclick");
  });

  test("fails when no production build exists", () => {
    expect(() => verifyDeploymentOutput(join(scratch, "missing"))).toThrow();
  });
});
