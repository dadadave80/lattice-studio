import { describe, expect, test } from "bun:test";
import { BUDGETS, type BuildFile, classifyBuild, notPrecachedOf, parseIndexHtml, renderReport } from "./size-logic.ts";

const gzipStub = (b: Uint8Array): Uint8Array => b; // 1:1 "gzip" so tests reason in raw bytes

function file(path: string, size: number): BuildFile {
  return { path, bytes: new Uint8Array(size) };
}

describe("parseIndexHtml", () => {
  test("reads the entry script, modulepreloads and stylesheets", () => {
    const html = `<!doctype html><html><head>
      <script type="module" crossorigin src="/assets/index-ABC.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/vendor-DEF.js">
      <link rel="stylesheet" crossorigin href="/assets/index-GHI.css">
    </head><body></body></html>`;
    expect(parseIndexHtml(html)).toEqual({
      entryScripts: ["/assets/index-ABC.js"],
      modulePreloads: ["/assets/vendor-DEF.js"],
      stylesheets: ["/assets/index-GHI.css"],
    });
  });

  test("ignores links that aren't modulepreload or stylesheet", () => {
    const html = `<link rel="icon" href="/favicon.svg"><link rel="manifest" href="/manifest.webmanifest">`;
    expect(parseIndexHtml(html)).toEqual({ entryScripts: [], modulePreloads: [], stylesheets: [] });
  });
});

describe("classifyBuild", () => {
  const html = `<script type="module" src="/assets/entry.js"></script><link rel="stylesheet" href="/assets/entry.css">`;

  test("sums the entry chunk and modulepreloads into first-load JS", () => {
    const html2 = `${html}<link rel="modulepreload" href="/assets/vendor.js">`;
    const report = classifyBuild({
      indexHtml: html2,
      files: [file("assets/entry.js", 100_000), file("assets/vendor.js", 50_000), file("assets/entry.css", 1000)],
      catalogIndex: null,
      gzip: gzipStub,
    });
    const jsRow = report.rows.find((r) => r.item === "First-load JavaScript");
    expect(jsRow?.gz).toBe(150_000);
    expect(jsRow?.ok).toBe(true);
  });

  test("flags first-load JS over budget", () => {
    const report = classifyBuild({
      indexHtml: html,
      files: [file("assets/entry.js", BUDGETS.firstLoadJs + 1), file("assets/entry.css", 1000)],
      catalogIndex: null,
      gzip: gzipStub,
    });
    const jsRow = report.rows.find((r) => r.item === "First-load JavaScript");
    expect(jsRow?.ok).toBe(false);
    expect(report.ok).toBe(false);
  });

  test("a chunk not referenced by index.html is a lazy chunk, budgeted individually", () => {
    const report = classifyBuild({
      indexHtml: html,
      files: [file("assets/entry.js", 1000), file("assets/entry.css", 100), file("assets/wallet-XYZ.js", BUDGETS.lazyChunk + 1)],
      catalogIndex: null,
      gzip: gzipStub,
    });
    const lazy = report.rows.find((r) => r.item.startsWith("Lazy chunk wallet"));
    expect(lazy?.ok).toBe(false);
    expect(report.ok).toBe(false);
  });

  test("a chunk named for an explicit-action feature (elk, walletconnect) is listed but never fails", () => {
    const report = classifyBuild({
      indexHtml: html,
      files: [file("assets/entry.js", 1000), file("assets/entry.css", 100), file("assets/elk-worker-XYZ.js", 500_000)],
      catalogIndex: null,
      gzip: gzipStub,
    });
    const lazy = report.rows.find((r) => r.item.includes("elk-worker"));
    expect(lazy?.warnOnly).toBe(true);
    expect(lazy?.item).toContain("no budget");
    expect(report.ok).toBe(true);
  });

  test("a chunk the build doesn't precache (WalletConnect's SDK, whatever its name) is listed but never fails", () => {
    const report = classifyBuild({
      indexHtml: html,
      files: [file("assets/entry.js", 1000), file("assets/entry.css", 100), file("assets/core-XYZ.js", 120_000)],
      catalogIndex: null,
      gzip: gzipStub,
      notPrecached: ["assets/core-XYZ.js"],
    });
    const lazy = report.rows.find((r) => r.item.includes("core-XYZ"));
    expect(lazy?.warnOnly).toBe(true);
    expect(lazy?.item).toContain("no budget");
    expect(report.ok).toBe(true);
  });

  test("fonts are counted by file and raw bytes, not gzipped", () => {
    const report = classifyBuild({
      indexHtml: html,
      files: [file("assets/entry.js", 1000), file("assets/entry.css", 100), file("assets/inter.woff2", 40_000), file("assets/mono.woff2", 20_000)],
      catalogIndex: null,
      gzip: () => new Uint8Array(1), // if size.ts ever gzipped fonts, this would make the test fail
    });
    const fonts = report.rows.find((r) => r.item.startsWith("Fonts"));
    expect(fonts?.raw).toBe(60_000);
    expect(fonts?.item).toBe("Fonts (2 files)");
    expect(fonts?.ok).toBe(true);
  });

  test("more than 2 font files fails even under the byte budget", () => {
    const report = classifyBuild({
      indexHtml: html,
      files: [
        file("assets/entry.js", 1000),
        file("assets/entry.css", 100),
        file("assets/a.woff2", 1000),
        file("assets/b.woff2", 1000),
        file("assets/c.woff2", 1000),
      ],
      catalogIndex: null,
      gzip: gzipStub,
    });
    const fonts = report.rows.find((r) => r.item.startsWith("Fonts"));
    expect(fonts?.ok).toBe(false);
    expect(report.ok).toBe(false);
  });

  test("the catalog index warns, never fails, even far over budget", () => {
    const report = classifyBuild({
      indexHtml: html,
      files: [file("assets/entry.js", 1000), file("assets/entry.css", 100)],
      catalogIndex: file("catalog/fixture/index.json", BUDGETS.catalogIndex * 10),
      gzip: gzipStub,
    });
    const catalog = report.rows.find((r) => r.item === "Catalog index");
    expect(catalog?.ok).toBe(false);
    expect(catalog?.warnOnly).toBe(true);
    expect(report.ok).toBe(true);
  });

  test("no catalog index is reported, not skipped, and never fails", () => {
    const report = classifyBuild({
      indexHtml: html,
      files: [file("assets/entry.js", 1000), file("assets/entry.css", 100)],
      catalogIndex: null,
      gzip: gzipStub,
    });
    const catalog = report.rows.find((r) => r.item === "Catalog index");
    expect(catalog).toBeDefined();
    expect(catalog?.ok).toBe(true);
  });

  test("with no lazy chunks, a row still names the budget", () => {
    const report = classifyBuild({
      indexHtml: html,
      files: [file("assets/entry.js", 1000), file("assets/entry.css", 100)],
      catalogIndex: null,
      gzip: gzipStub,
    });
    expect(report.rows.find((r) => r.item === "Lazy chunks")).toBeDefined();
  });
});

describe("renderReport", () => {
  test("names every row and prints an over-budget explanation", () => {
    const report = classifyBuild({
      indexHtml: `<script type="module" src="/assets/entry.js"></script>`,
      files: [file("assets/entry.js", BUDGETS.firstLoadJs + 5000)],
      catalogIndex: null,
      gzip: gzipStub,
    });
    const text = renderReport(report);
    expect(text).toContain("First-load JavaScript");
    expect(text).toContain("CSS");
    expect(text).toContain("Fonts");
    expect(text).toContain("Catalog index");
    expect(text).toContain("Lazy chunks");
    expect(text).toContain("over its");
  });
});

describe("notPrecachedOf", () => {
  test("reads release.json's notPrecached", () => {
    const json = JSON.stringify({ assets: ["assets/a.js", "assets/core-X.js"], notPrecached: ["assets/core-X.js"] });
    expect(notPrecachedOf(json)).toEqual(["assets/core-X.js"]);
  });

  test("is empty when the manifest can't be read or has no list", () => {
    expect(notPrecachedOf("not json")).toEqual([]);
    expect(notPrecachedOf(JSON.stringify({ assets: [] }))).toEqual([]);
  });
});
