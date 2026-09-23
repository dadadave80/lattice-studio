import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { carryPrevious, parseRelease, sourceFor } from "./carry-previous.ts";
import { formatJson } from "./headers.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function release(files: Record<string, string>, notPrecached: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "studio-release-"));
  dirs.push(dir);
  mkdirSync(join(dir, "assets"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  const assets = Object.keys(files).filter((f) => f.startsWith("assets/")).sort();
  writeFileSync(join(dir, "release.json"), formatJson({ assets, notPrecached }));
  return dir;
}

describe("carryPrevious", () => {
  test("copies the previous release's chunks this build lacks and records them", async () => {
    const previous = release({ "assets/index-OLD.js": "old entry", "assets/lazy-OLD.js": "old lazy", "assets/font-SAME.woff2": "font" });
    const out = release({ "assets/index-NEW.js": "new entry", "assets/font-SAME.woff2": "font" });
    const result = await carryPrevious(sourceFor(previous), out);
    expect(result).toEqual({ carried: ["assets/index-OLD.js", "assets/lazy-OLD.js"], alreadyPresent: 1 });
    expect(readFileSync(join(out, "assets/lazy-OLD.js"), "utf8")).toBe("old lazy");
    const own = JSON.parse(readFileSync(join(out, "release.json"), "utf8")) as { assets: string[]; carried: string[] };
    // Its own list stays its own, so the next release carries only this one's files.
    expect(own.assets).toEqual(["assets/font-SAME.woff2", "assets/index-NEW.js"]);
    expect(own.carried).toEqual(["assets/index-OLD.js", "assets/lazy-OLD.js"]);
  });

  test("never overwrites this build's files", async () => {
    const previous = release({ "assets/a-1.js": "previous bytes" });
    const out = release({ "assets/a-1.js": "this build's bytes" });
    await carryPrevious(sourceFor(previous), out);
    expect(readFileSync(join(out, "assets/a-1.js"), "utf8")).toBe("this build's bytes");
  });

  test("reads a previous release from its URL", async () => {
    const files: Record<string, string> = {
      "release.json": formatJson({ assets: ["assets/old-1.js"], notPrecached: [] }),
      "assets/old-1.js": "from the network",
    };
    const requested: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      requested.push(url.href);
      const body = files[url.pathname.replace(/^\/studio\//, "")];
      return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
    }) as typeof fetch;
    const out = release({ "assets/new-1.js": "new" });
    const result = await carryPrevious(sourceFor("https://studio.example/studio", fetcher), out);
    expect(result.carried).toEqual(["assets/old-1.js"]);
    expect(requested).toEqual(["https://studio.example/studio/release.json", "https://studio.example/studio/assets/old-1.js"]);
    expect(readFileSync(join(out, "assets/old-1.js"), "utf8")).toBe("from the network");
  });

  test("refuses a manifest that points outside assets/", async () => {
    const previous = release({ "assets/a-1.js": "a" });
    writeFileSync(join(previous, "release.json"), formatJson({ assets: ["../../etc/passwd"], notPrecached: [] }));
    const out = release({ "assets/b-1.js": "b" });
    await expect(carryPrevious(sourceFor(previous), out)).rejects.toThrow(/isn't a file under assets/);
    expect(existsSync(join(out, "assets", "a-1.js"))).toBe(false);
  });

  test("says what's missing when the build or the previous release has no manifest", async () => {
    const empty = mkdtempSync(join(tmpdir(), "studio-release-"));
    dirs.push(empty);
    const out = release({ "assets/b-1.js": "b" });
    await expect(carryPrevious(sourceFor(empty), out)).rejects.toThrow(/release.json doesn't exist/);
    await expect(carryPrevious(sourceFor(out), empty)).rejects.toThrow(/run the build first/);
  });
});

describe("parseRelease", () => {
  test("rejects anything but a list of asset names", () => {
    expect(() => parseRelease("nope", "x")).toThrow("x isn't JSON.");
    expect(() => parseRelease("{}", "x")).toThrow("x has no list of assets.");
    expect(parseRelease(formatJson({ assets: ["assets/a.js"] }), "x")).toEqual({ assets: ["assets/a.js"], notPrecached: [] });
  });
});

describe("the command", () => {
  test("carries nothing, and says so, without a previous release", () => {
    const out = release({ "assets/a-1.js": "a" });
    const run = Bun.spawnSync(["bun", join(import.meta.dir, "carry-previous.ts"), "--out", out, "--from", ""]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toContain("nothing was carried");
  });

  test("exits 1 with the reason when the previous release can't be read", () => {
    const out = release({ "assets/a-1.js": "a" });
    const run = Bun.spawnSync(["bun", join(import.meta.dir, "carry-previous.ts"), "--out", out, "--from", join(out, "missing")]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr.toString()).toContain("Couldn't carry the previous release's chunks");
  });
});
