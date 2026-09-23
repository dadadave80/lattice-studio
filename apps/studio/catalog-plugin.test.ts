import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogMiddleware, mergedManifest } from "./catalog-plugin.ts";

/** Each test gets its own folders, removed after it, so the tests run in any order. */
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(path: string, body: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body));
}

const entry = (id: string) => ({ id, tag: id, commit: "0".repeat(40), hash: `0x${"0".repeat(64)}`, path: id });

/** A fresh root with the fixtures' folder filled in and an empty generated folder. */
function setup(): { root: string; generated: string; fixtures: string } {
  const root = mkdtempSync(join(tmpdir(), "studio-catalog-"));
  roots.push(root);
  const generated = join(root, "catalog");
  const fixtures = join(root, "fixtures");
  write(join(fixtures, "manifest.json"), { default: "fixture", catalogs: [entry("fixture"), entry("fixture-next")] });
  write(join(fixtures, "fixture", "index.json"), { from: "fixtures" });
  write(join(fixtures, "fixture", "shards", "ERC20.json"), { name: "ERC20" });
  return { root, generated, fixtures };
}

type Answer = { status: number; body: string; next: boolean };

function get(sources: string[], url: string): Answer {
  const answer: Answer = { status: 0, body: "", next: false };
  const res = {
    statusCode: 0,
    setHeader: () => {},
    end(body: string | Buffer) {
      answer.status = this.statusCode;
      answer.body = String(body);
    },
  };
  catalogMiddleware(sources)({ url } as IncomingMessage, res as unknown as ServerResponse, () => {
    answer.next = true;
  });
  return answer;
}

describe("catalog serving", () => {
  test("with neither folder, the manifest is a 404, not the SPA page", () => {
    const { root } = setup();
    expect(get([join(root, "none")], "/catalog/manifest.json").status).toBe(404);
  });

  test("fixtures alone serve their manifest and files", () => {
    const { generated, fixtures } = setup();
    const sources = [generated, fixtures];
    expect(JSON.parse(get(sources, "/catalog/manifest.json").body).default).toBe("fixture");
    expect(get(sources, "/catalog/fixture/shards/ERC20.json")).toMatchObject({ status: 200, body: '{"name":"ERC20"}' });
    expect(get(sources, "/catalog/fixture/shards/Nope.json").status).toBe(404);
  });

  test("the generated catalog's default wins and fixtures are appended", () => {
    const { generated, fixtures } = setup();
    write(join(generated, "manifest.json"), { default: "v0.4.0", catalogs: [entry("v0.4.0")] });
    const merged = mergedManifest([generated, fixtures]);
    expect(merged?.default).toBe("v0.4.0");
    expect(merged?.catalogs.map((c) => c.id)).toEqual(["v0.4.0", "fixture", "fixture-next"]);
  });

  test("paths can't leave the catalog folders", () => {
    const { root, generated, fixtures } = setup();
    write(join(root, "secret.json"), "{}");
    expect(get([generated, fixtures], "/catalog/../secret.json").status).toBe(404);
    expect(get([generated, fixtures], "/catalog/%2e%2e/secret.json").status).toBe(404);
  });

  test("other paths pass through", () => {
    const { fixtures } = setup();
    expect(get([fixtures], "/src/main.tsx").next).toBe(true);
  });
});
