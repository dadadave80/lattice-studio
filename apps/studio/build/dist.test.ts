/**
 * Real builds, checked from what lands in `dist/`:
 *
 * - a fixture app built with the same plugins, which has what the app will have once later work lands (an
 *   inline critical style, lazy chunks and so an SRI import map, ELK and WalletConnect behind `import()`);
 * - the app itself, Vercel and IPFS variants, as `bun run build` makes them.
 *
 * Each builds into a scratch folder; nothing here touches `apps/studio/dist` or the committed `vercel.json`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { appDir, repoRoot } from "../local-env.ts";
import { studioCsp } from "./csp.ts";
import { cspOf, metaCspOf, vercelConfig, type VercelConfig } from "./headers.ts";
import type { ReleaseManifest } from "./precache.ts";
import { pwaPlugins } from "./pwa.ts";
import { verifyIpfs, verifyVercel } from "./verify-headers.ts";

const TIMEOUT = 120_000;
const scratch = mkdtempSync(join(tmpdir(), "studio-dist-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Hashes computed here, independently of `headers.ts`, the way a browser computes them. */
function hashesIn(html: string, tag: "script" | "style"): string[] {
  const out: string[] = [];
  for (const [, attrs = "", body = ""] of html.matchAll(new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)</${tag}>`, "g"))) {
    if (attrs.includes("src=")) continue;
    out.push(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
  }
  return out;
}

function directive(csp: string, name: string): string[] {
  const found = csp.split("; ").find((d) => d.startsWith(`${name} `));
  return found ? found.split(" ").slice(1) : [];
}

function precached(dist: string): string[] {
  const sw = readFileSync(join(dist, "sw.js"), "utf8");
  return [...sw.matchAll(/"?url"?\s*:\s*"([^"]+)"/g)].map((m) => (m[1] ?? "").replace(/^\.?\//, ""));
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

const committedSchema = join(appDir, "public", "schema", "recipe.v1.json");
/** The committed schema before any build here ran: a build may only confirm it, never rewrite it. */
const schemaBefore = readFileSync(committedSchema, "utf8");

/** `vite build` of the app, as `bun run build` runs it (Node, the app's own config). */
function buildApp(outDir: string, mode: string, env: Record<string, string> = {}): void {
  const vite = join(repoRoot, "node_modules", ".bin", "vite");
  const run = Bun.spawnSync([vite, "build", "--mode", mode, "--outDir", outDir, "--emptyOutDir"], {
    cwd: appDir,
    // `bun test` sets NODE_ENV=test; `bun run build` doesn't.
    env: { ...process.env, NODE_ENV: "production", ...env },
  });
  if (run.exitCode !== 0) throw new Error(`vite build failed:\n${run.stderr.toString()}${run.stdout.toString()}`);
}

describe("fixture app with the same plugins", () => {
  const root = join(scratch, "fixture");
  const out = join(root, "dist");
  const vercelJson = join(scratch, "fixture-vercel.json");
  const critical = "html{background:#000}body{margin:0}";

  beforeAll(async () => {
    const files: Record<string, string> = {
      "index.html": `<!doctype html><html><head><meta charset="UTF-8"><title>Fixture</title><style>${critical}</style></head>` +
        `<body><div id="root"></div><script type="module" src="/main.js"></script></body></html>`,
      "main.js": [
        'import { shared } from "./shared.js";',
        "export const main = shared;",
        'document.getElementById("root").onclick = () => {',
        '  import("./feature.js");',
        '  import("elkjs");',
        '  import("@walletconnect/ethereum-provider");',
        "};",
      ].join("\n"),
      "shared.js": "export const shared = 1;",
      "feature.js": 'import { shared } from "./shared.js"; export const feature = `first-party-${shared}`;',
      "node_modules/elkjs/package.json": '{"name":"elkjs","type":"module","main":"index.js"}',
      "node_modules/elkjs/index.js": 'export const elk = "elk"; export const later = () => import("only-elk-needs-me");',
      "node_modules/only-elk-needs-me/package.json": '{"name":"only-elk-needs-me","type":"module","main":"index.js"}',
      "node_modules/only-elk-needs-me/index.js": 'export const dep = "dep";',
      "node_modules/@walletconnect/ethereum-provider/package.json": '{"name":"@walletconnect/ethereum-provider","type":"module","main":"index.js"}',
      "node_modules/@walletconnect/ethereum-provider/index.js": 'export const wc = "wc";',
    };
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), body);
    }
    const env = { mode: "production", command: "build" as const, isSsrBuild: false, isPreview: false };
    const previous = process.env.STUDIO_VERCEL_JSON;
    process.env.STUDIO_VERCEL_JSON = vercelJson;
    try {
      await build({
        root,
        configFile: false,
        logLevel: "silent",
        publicDir: false,
        build: { outDir: out, emptyOutDir: true },
        plugins: [...studioCsp(env), ...pwaPlugins(env, { publicDir: join(root, "public") })],
      });
    } finally {
      if (previous === undefined) delete process.env.STUDIO_VERCEL_JSON;
      else process.env.STUDIO_VERCEL_JSON = previous;
    }
  }, TIMEOUT);

  test("the CSP header allows exactly the page's inline style and SRI import map, by hash", () => {
    const html = readFileSync(join(out, "index.html"), "utf8");
    expect(html).toContain('<script type="importmap">');
    const csp = cspOf(readJson<VercelConfig>(vercelJson)) ?? "";
    const scripts = hashesIn(html, "script");
    const styles = hashesIn(html, "style");
    expect(scripts).toHaveLength(1);
    expect(styles).toHaveLength(1);
    expect(directive(csp, "script-src")).toEqual(["'self'", ...scripts]);
    expect(directive(csp, "style-src")).toEqual(["'self'", ...styles]);
    expect(verifyVercel(html, readJson<VercelConfig>(vercelJson)).ok).toBe(true);
  });

  test("every chunk carries its integrity, in the import map or on its tag", () => {
    const html = readFileSync(join(out, "index.html"), "utf8");
    const chunks = readdirSync(join(out, "assets")).filter((f) => f.endsWith(".js"));
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      const bytes = readFileSync(join(out, "assets", chunk));
      expect(html).toContain(`sha384-${createHash("sha384").update(bytes).digest("base64")}`);
    }
  });

  test("the precache holds the shell and first-party chunks, but not ELK, WalletConnect or what only ELK loads", () => {
    const release = readJson<ReleaseManifest>(join(out, "release.json"));
    const cached = precached(out);
    const lazyOnly = release.notPrecached;
    expect(lazyOnly).toHaveLength(3);
    const contents = (file: string) => readFileSync(join(out, file), "utf8");
    const holds = (word: string) => lazyOnly.some((f) => new RegExp(`["'\`]${word}["'\`]`).test(contents(f)));
    expect(holds("elk")).toBe(true);
    expect(holds("wc")).toBe(true);
    expect(holds("dep")).toBe(true);
    for (const file of lazyOnly) expect(cached).not.toContain(file);
    expect(cached).toContain("index.html");
    for (const chunk of release.assets.filter((a) => !lazyOnly.includes(a))) expect(cached).toContain(chunk);
    const feature = release.assets.find((a) => a.endsWith(".js") && contents(a).includes("first-party-"));
    expect(feature).toBeDefined();
    expect(cached).toContain(feature ?? "");
  });
});

describe("the app, Vercel build", () => {
  const out = join(scratch, "vercel");
  const vercelJson = join(scratch, "vercel.json");

  beforeAll(() => buildApp(out, "production", { STUDIO_VERCEL_JSON: vercelJson }), TIMEOUT);

  test("the CSP header written for the build matches the hashes recomputed from dist/index.html", () => {
    const html = readFileSync(join(out, "index.html"), "utf8");
    const config = readJson<VercelConfig>(vercelJson);
    const csp = cspOf(config) ?? "";
    expect(directive(csp, "script-src")).toEqual(["'self'", ...hashesIn(html, "script")]);
    expect(directive(csp, "style-src")).toEqual(["'self'", ...hashesIn(html, "style")]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(verifyVercel(html, config)).toEqual({ ok: true, text: "vercel.json's CSP matches the built index.html." });
    expect(metaCspOf(html)).toBeNull();
  });

  test("the committed vercel.json differs from the generated one only in the CSP's hashes", () => {
    const committed = readJson<VercelConfig>(join(appDir, "vercel.json"));
    const generated = readJson<VercelConfig>(vercelJson);
    const hashless = (c: VercelConfig) => cspOf(c)?.replace(/ 'sha256-[^']+'/g, "") ?? "";
    expect(hashless(committed)).toBe(hashless(generated));
    expect(committed).toEqual(vercelConfig(cspOf(committed) ?? ""));
  });

  test("the service worker precaches the shell, the entry, the catalog manifest and indexes, but no shards", () => {
    const cached = precached(out);
    const release = readJson<ReleaseManifest>(join(out, "release.json"));
    expect(cached).toContain("index.html");
    expect(cached).toContain("catalog/manifest.json");
    expect(cached).toContain("schema/recipe.v1.json");
    expect(cached.some((f) => /^catalog\/[^/]+\/index\.json$/.test(f))).toBe(true);
    expect(cached.some((f) => /\/(shards|code|json)\//.test(f))).toBe(false);
    for (const chunk of release.assets.filter((a) => !release.notPrecached.includes(a))) expect(cached).toContain(chunk);
    expect(new Set(cached).size).toBe(cached.length);
    const sw = readFileSync(join(out, "sw.js"), "utf8");
    expect(sw).toContain("CacheFirst");
    expect(sw).toContain("lattice-catalog-shards");
  });

  test("registers nothing inline and ships the manifest, icons and schema", () => {
    const html = readFileSync(join(out, "index.html"), "utf8");
    expect(html).not.toContain("registerSW");
    expect(html).toContain('rel="manifest"');
    const manifest = readJson<{ icons: { src: string; purpose: string }[]; display: string }>(join(out, "manifest.webmanifest"));
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) expect(existsSync(join(out, icon.src))).toBe(true);
    expect(existsSync(join(out, "schema", "recipe.v1.json"))).toBe(true);
    expect(existsSync(join(out, "favicon.svg"))).toBe(true);
  });
});

describe("the app, IPFS build", () => {
  const out = join(scratch, "ipfs");

  beforeAll(() => buildApp(out, "ipfs"), TIMEOUT);

  test("uses relative URLs and carries its CSP in a meta tag without frame-ancestors", () => {
    const html = readFileSync(join(out, "index.html"), "utf8");
    expect(html).toContain('src="./assets/');
    expect(html).not.toContain('src="/assets/');
    const csp = metaCspOf(html) ?? "";
    expect(csp).not.toContain("frame-ancestors");
    expect(directive(csp, "script-src")).toEqual(["'self'", ...hashesIn(html, "script")]);
    expect(verifyIpfs(html).ok).toBe(true);
    const manifest = readJson<{ start_url: string; scope: string }>(join(out, "manifest.webmanifest"));
    expect(manifest.start_url).toBe("./");
    expect(manifest.scope).toBe("./");
  });
});

describe("the committed files", () => {
  // Keep the tree as it was even when this fails: the failure is the signal.
  afterAll(() => writeFileSync(committedSchema, schemaBefore));

  test("the builds left public/schema/recipe.v1.json as committed (else core's schema changed: build and commit it)", () => {
    expect(readFileSync(committedSchema, "utf8")).toBe(schemaBefore);
  });
});
