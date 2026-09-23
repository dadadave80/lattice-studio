import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  E2E_CONNECT_SOURCE, contentSecurityPolicy, cspHash, cspMismatch, cspOf, formatJson, inlineAttributeProblems,
  inlineHashes, injectCspMeta, isE2EBuild, metaCspOf, vercelConfig,
} from "./headers.ts";
import { secureHtml, vercelJsonTarget } from "./csp.ts";
import { e2eGuard } from "../vite.config.ts";

const sha = (text: string) => `sha256-${createHash("sha256").update(text).digest("base64")}`;

const IMPORT_MAP = '{"imports":{},"integrity":{"/assets/a-1.js":"sha384-x"}}';
const CRITICAL = "html{background:var(--lx-ground)}";
const PAGE = `<!doctype html><html><head><meta charset="UTF-8">
<style>${CRITICAL}</style>
<script type="importmap">${IMPORT_MAP}</script>
<script type="module" crossorigin src="/assets/index-1.js" integrity="sha384-y"></script>
</head><body><div id="root"></div></body></html>`;

describe("inlineHashes", () => {
  test("hashes the exact text of inline scripts and styles, and skips scripts with src", () => {
    expect(inlineHashes(PAGE)).toEqual({ scripts: [sha(IMPORT_MAP)], styles: [sha(CRITICAL)] });
    expect(cspHash(IMPORT_MAP)).toBe(sha(IMPORT_MAP));
  });

  test("keeps whitespace, so the hash matches what the browser hashes", () => {
    const html = "<script>\n  a()\n</script><style> b{} </style>";
    expect(inlineHashes(html)).toEqual({ scripts: [sha("\n  a()\n")], styles: [sha(" b{} ")] });
  });

  test("lists a repeated block once and finds none in a page without them", () => {
    expect(inlineHashes("<style>x</style><style>x</style>").styles).toHaveLength(1);
    expect(inlineHashes("<html><head></head></html>")).toEqual({ scripts: [], styles: [] });
  });
});

describe("contentSecurityPolicy", () => {
  test("is spec L871-L875 with the import map and critical CSS hashes", () => {
    const csp = contentSecurityPolicy({ scripts: ["sha256-MAP"], styles: ["sha256-CSS"] }, { frameAncestors: true });
    expect(csp).toBe(
      "default-src 'self'; script-src 'self' 'sha256-MAP'; style-src 'self' 'sha256-CSS'; " +
        "img-src 'self' data: blob: https:; font-src 'self'; worker-src 'self'; manifest-src 'self'; " +
        "object-src 'none'; base-uri 'self'; form-action 'none'; connect-src 'self' https: wss:; " +
        "frame-src https://verify.walletconnect.org https://secure.walletconnect.org; frame-ancestors 'none'",
    );
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  test("leaves frame-ancestors out of the IPFS meta", () => {
    const csp = contentSecurityPolicy({ scripts: [], styles: [] }, { frameAncestors: false });
    expect(csp).not.toContain("frame-ancestors");
    expect(csp).toContain("script-src 'self'; style-src 'self';");
  });
});

describe("the end-to-end build's connect-src (Q0)", () => {
  const connectSrc = (csp: string) => csp.split("; ").find((d) => d.startsWith("connect-src"));

  /** Runs `fn` with `VITE_STUDIO_E2E` set to `value` (or unset), then puts the environment back. */
  function withFlag<T>(value: string | undefined, fn: () => T): T {
    const before = process.env.VITE_STUDIO_E2E;
    if (value === undefined) delete process.env.VITE_STUDIO_E2E;
    else process.env.VITE_STUDIO_E2E = value;
    try {
      return fn();
    } finally {
      if (before === undefined) delete process.env.VITE_STUDIO_E2E;
      else process.env.VITE_STUDIO_E2E = before;
    }
  }

  test("adds the loopback Anvil origin in --mode e2e (the flag set)", () => {
    const csp = withFlag("1", () => secureHtml(PAGE, "vercel").csp);
    expect(connectSrc(csp)).toBe(`connect-src 'self' https: wss: ${E2E_CONNECT_SOURCE}`);
    expect(E2E_CONNECT_SOURCE).toBe("http://127.0.0.1:*");
    expect(isE2EBuild({ VITE_STUDIO_E2E: "1" })).toBe(true);
  });

  test("production and IPFS builds don't get it", () => {
    withFlag(undefined, () => {
      expect(connectSrc(secureHtml(PAGE, "vercel").csp)).toBe("connect-src 'self' https: wss:");
      expect(connectSrc(secureHtml(PAGE, "ipfs").csp)).toBe("connect-src 'self' https: wss:");
      expect(metaCspOf(secureHtml(PAGE, "ipfs").html)).not.toContain("127.0.0.1");
    });
    expect(isE2EBuild({})).toBe(false);
    expect(isE2EBuild({ VITE_STUDIO_E2E: "" })).toBe(false);
  });

  test("the flag can't reach a production or IPFS build: the config's guard refuses it", () => {
    expect(() => e2eGuard("production", "build", "1")).toThrow(/--mode e2e/);
    expect(() => e2eGuard("ipfs", "build", "1")).toThrow(/--mode e2e/);
    expect(() => e2eGuard("e2e", "build", "1")).not.toThrow();
  });

  test("an explicit option wins over the environment", () => {
    const hashes = { scripts: [], styles: [] };
    withFlag("1", () => expect(contentSecurityPolicy(hashes, { frameAncestors: true, e2e: false })).not.toContain("127.0.0.1"));
    withFlag(undefined, () => expect(contentSecurityPolicy(hashes, { frameAncestors: true, e2e: true })).toContain(E2E_CONNECT_SOURCE));
  });
});

describe("inlineAttributeProblems", () => {
  test("flags handlers and style attributes, which hashes can't allow", () => {
    expect(inlineAttributeProblems('<body onload="x()"><div style="color:red"></div></body>')).toHaveLength(2);
    expect(inlineAttributeProblems(PAGE)).toEqual([]);
  });

  test("ignores text inside scripts and styles", () => {
    expect(inlineAttributeProblems('<script>const s = "<a onclick=1>"</script>')).toEqual([]);
  });

  test("fails the build rather than ship markup the browser would drop", () => {
    expect(() => secureHtml('<html><head></head><body style="margin:0"></body></html>', "vercel")).toThrow(/style attribute/);
  });
});

describe("injectCspMeta", () => {
  test("puts the policy right after the charset, before the blocks it governs", () => {
    const csp = contentSecurityPolicy(inlineHashes(PAGE), { frameAncestors: false });
    const html = injectCspMeta(PAGE, csp);
    expect(html.indexOf("Content-Security-Policy")).toBeGreaterThan(html.indexOf("charset"));
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<style>"));
    expect(metaCspOf(html)).toBe(csp);
    // The meta tag itself isn't inline script or style, so the hashes don't move.
    expect(inlineHashes(html)).toEqual(inlineHashes(PAGE));
  });

  test("replaces an earlier policy instead of adding a second", () => {
    const once = injectCspMeta(PAGE, "default-src 'none'");
    const twice = injectCspMeta(once, "default-src 'self'");
    expect(twice.match(/Content-Security-Policy/g)).toHaveLength(1);
    expect(metaCspOf(twice)).toBe("default-src 'self'");
  });

  test("the IPFS build writes the meta; the Vercel build leaves the page alone", () => {
    expect(metaCspOf(secureHtml(PAGE, "ipfs").html)).not.toBeNull();
    expect(secureHtml(PAGE, "vercel").html).toBe(PAGE);
  });
});

describe("vercelConfig", () => {
  const config = vercelConfig("default-src 'self'");

  test("sends the CSP and COOP on every path", () => {
    expect(cspOf(config)).toBe("default-src 'self'");
    const all = config.headers.find((h) => h.source === "/(.*)")?.headers ?? [];
    expect(all).toContainEqual({ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" });
    expect(all.some((h) => h.key.startsWith("Cross-Origin-Embedder"))).toBe(false);
  });

  test("caches hashed assets forever and makes everything else revalidate", () => {
    const cacheRules = config.headers.filter((h) => h.headers.some((x) => x.key === "Cache-Control"));
    const rule = (path: string) =>
      cacheRules.find((r) => new RegExp(`^${r.source.replace("(.*)", ".*")}$`).test(path))?.headers[0]?.value;
    expect(rule("/assets/index-abc.js")).toBe("public, max-age=31536000, immutable");
    for (const path of ["/", "/index.html", "/sw.js", "/manifest.webmanifest", "/catalog/fixture/index.json"]) {
      expect(rule(path)).toBe("no-cache");
    }
  });

  test("builds, carries the previous release and verifies the headers before deploying", () => {
    expect(config.buildCommand).toContain("bun run build");
    expect(config.buildCommand).toContain("carry-previous.ts");
    expect(config.buildCommand).toContain("verify-headers.ts");
    expect(config.outputDirectory).toBe("dist");
  });

  test("is written deterministically", () => {
    expect(formatJson(config)).toBe(formatJson(vercelConfig("default-src 'self'")));
    expect(formatJson(config).endsWith("}\n")).toBe(true);
  });
});

describe("cspMismatch", () => {
  test("is null when the header matches the page and explains the difference when it doesn't", () => {
    const csp = contentSecurityPolicy(inlineHashes(PAGE), { frameAncestors: true });
    expect(cspMismatch(PAGE, csp, { frameAncestors: true })).toBeNull();
    const stale = PAGE.replace(CRITICAL, `${CRITICAL}a{}`);
    expect(cspMismatch(stale, csp, { frameAncestors: true })).toContain("doesn't match");
    expect(cspMismatch(PAGE, null, { frameAncestors: true })).toBe("No Content-Security-Policy is set.");
  });
});

describe("vercelJsonTarget", () => {
  test("writes nothing by default, the app's own file for 1, else the given path", () => {
    expect(vercelJsonTarget(undefined, "/app", "/cwd")).toBeNull();
    expect(vercelJsonTarget("", "/app", "/cwd")).toBeNull();
    expect(vercelJsonTarget("1", "/app", "/cwd")).toBe("/app/vercel.json");
    expect(vercelJsonTarget("out/v.json", "/app", "/cwd")).toBe("/cwd/out/v.json");
    expect(vercelJsonTarget("/tmp/v.json", "/app", "/cwd")).toBe("/tmp/v.json");
  });
});
