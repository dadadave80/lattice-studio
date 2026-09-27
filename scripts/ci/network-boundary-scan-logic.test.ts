import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";
import { ALLOWED_FETCH_FILES, findNetworkCalls, isAllowedNetworkFile, parseSource } from "./network-boundary-scan-logic.ts";

function matches(source: string, fileName = "x.ts"): string[] {
  return findNetworkCalls(parseSource(fileName, source)).map((f) => f.match);
}

describe("findNetworkCalls", () => {
  test("a bare fetch call", () => {
    expect(matches(`await fetch(url);`)).toEqual(["fetch("]);
  });

  test("globalThis.fetch, window.fetch and self.fetch are caught too, not just a bare fetch(", () => {
    expect(matches(`globalThis.fetch(url);`)).toEqual(["globalThis.fetch("]);
    expect(matches(`window.fetch(url);`)).toEqual(["window.fetch("]);
    expect(matches(`self.fetch(url);`)).toEqual(["self.fetch("]);
  });

  test("a fetch method on some other receiver is left alone (not a global)", () => {
    expect(matches(`api.fetch(url);`)).toEqual([]);
  });

  test("new WebSocket", () => {
    expect(matches(`const ws = new WebSocket(url);`)).toEqual(["new WebSocket("]);
  });

  test("createPublicClient and createWalletClient", () => {
    expect(matches(`createPublicClient({ chain, transport }); createWalletClient({ transport });`)).toEqual([
      "createPublicClient(",
      "createWalletClient(",
    ]);
  });

  test("a viem transport factory imported from viem", () => {
    const src = `import { http } from "viem";\nconst t = http(url);`;
    expect(matches(src)).toEqual(["http("]);
  });

  test("a same-named function that isn't imported from viem is left alone", () => {
    const src = `function http(url: string) { return url; }\nconst t = http(url);`;
    expect(matches(src)).toEqual([]);
  });

  test("webSocket and custom transports, imported from a viem subpath", () => {
    const src = `import { webSocket, custom } from "viem/clients";\nwebSocket(url); custom(provider);`;
    expect(matches(src)).toEqual(["webSocket(", "custom("]);
  });

  test("doesn't match unrelated copy that merely contains the word http", () => {
    expect(matches(`const description = "This won't be used: it needs a valid http(s) URL.";`)).toEqual([]);
  });
});

describe("isAllowedNetworkFile", () => {
  test("every file under chain/ is allowed", () => {
    expect(isAllowedNetworkFile("chain/infra/clients.ts")).toBe(true);
    expect(isAllowedNetworkFile("chain/deploy/machine.ts")).toBe(true);
  });

  test("the §19 row 2 same-origin catalog callers are allowed", () => {
    for (const f of ALLOWED_FETCH_FILES) expect(isAllowedNetworkFile(f), f).toBe(true);
  });

  test("an ordinary panel file is not allowed", () => {
    expect(isAllowedNetworkFile("panels/inspector/commands.ts")).toBe(false);
  });
});

// A regression guard for the allow-list itself: every listed file must exist, so a rename doesn't silently
// widen the boundary by pointing at nothing.
describe("ALLOWED_FETCH_FILES", () => {
  const root = join(import.meta.dir, "..", "..", "apps", "studio", "src");

  test("every listed file exists", () => {
    for (const f of ALLOWED_FETCH_FILES) expect(existsSync(join(root, f)), f).toBe(true);
  });
});

// The real repository must currently pass: every fetch/WebSocket/viem-client call outside chain/ is one of the
// §19 row 2 same-origin callers.
describe("the real app source", () => {
  const srcDir = join(import.meta.dir, "..", "..", "apps", "studio", "src");
  const TEST_FILE_PATTERN = /\.(test|browser\.test)\.tsx?$/;

  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name === "node_modules") return [];
      const p = join(dir, entry.name);
      if (entry.isDirectory()) return files(p);
      return /\.tsx?$/.test(entry.name) && !TEST_FILE_PATTERN.test(entry.name) ? [p] : [];
    });
  }

  test("no finding outside chain/ and the allowed callers", () => {
    const findings: string[] = [];
    for (const file of files(srcDir)) {
      const relPath = relative(srcDir, file);
      if (isAllowedNetworkFile(relPath)) continue;
      for (const f of findNetworkCalls(parseSource(file, readFileSync(file, "utf8")))) findings.push(`${relPath}:${f.line}: ${f.match}`);
    }
    expect(findings).toEqual([]);
  });
});
