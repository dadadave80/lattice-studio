// Pure logic behind `bun scripts/ci/size.ts` (spec L805-L817 "Budgets"; brief Q6 "size.ts"): classify a Vite
// build's output into first-load JS, first-load CSS, fonts, the catalog index and lazy chunks, then check each
// against its budget. Kept free of the filesystem and of `Bun.gzipSync` so it's testable with fixed bytes.

export type BuildFile = { readonly path: string; readonly bytes: Uint8Array<ArrayBuffer> };

export type SizeRow = {
  readonly item: string;
  readonly gz: number | null;
  readonly raw: number;
  readonly budget: number;
  /** Budget unit: gz'd bytes, or raw bytes for fonts (spec's Fonts row carries no "gz"). */
  readonly unit: "gz" | "raw";
  readonly warnOnly: boolean;
  readonly ok: boolean;
};

export type SizeReport = { readonly rows: SizeRow[]; readonly ok: boolean };

/** Budgets in bytes, spec L809-L814. */
export const BUDGETS = {
  // QUESTIONS Q19 (David, 2026-10-06): the sheet, the document commands' bodies, core's analysis engine and Base UI's
  // popups load after the first paint. That measured 247.6 KB (250.0 with a WalletConnect project id); the gate is
  // that plus 7.4 KB of headroom. The spec's 240 KB stays the target: core's analysis is still in the entry through
  // the contracts' default analysis provider (contracts/analysis.ts, frozen), about 14 KB.
  firstLoadJs: 255_000,
  css: 25_000,
  fontsTotal: 90_000,
  fontsCount: 2,
  catalogIndex: 60_000,
  lazyChunk: 70_000,
} as const;

/**
 * Chunks the spec exempts from the lazy-chunk budget (spec L814 "Loaded only on explicit action · No budget; not
 * precached"): by name, and every file the build leaves out of the precache (`release.json`'s `notPrecached`,
 * decided from the module graph by apps/studio/build/precache.ts), since the WalletConnect SDK's chunks are named
 * after their own modules ("core", "dist", "w3m-modal").
 */
const NO_BUDGET_PATTERN = /elk|walletconnect/i;

/** `release.json`'s `notPrecached` (apps/studio/build/precache.ts `ReleaseManifest`); none when it can't be read. */
export function notPrecachedOf(releaseJson: string): string[] {
  try {
    const manifest = JSON.parse(releaseJson) as { notPrecached?: unknown };
    return Array.isArray(manifest.notPrecached) ? manifest.notPrecached.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

const FONT_EXTENSIONS = [".woff2", ".woff", ".ttf", ".otf"];

function extname(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot);
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

/** `<script type="module" src="...">` and `<link rel="modulepreload" href="...">` and `<link rel="stylesheet" href="...">` from an index.html. */
export function parseIndexHtml(html: string): { readonly entryScripts: string[]; readonly modulePreloads: string[]; readonly stylesheets: string[] } {
  const entryScripts: string[] = [];
  const modulePreloads: string[] = [];
  const stylesheets: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const src = m[1];
    if (src) entryScripts.push(src);
  }
  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = m[1] ?? "";
    const relMatch = /\brel=["']([^"']+)["']/i.exec(attrs);
    const hrefMatch = /\bhref=["']([^"']+)["']/i.exec(attrs);
    const rel = relMatch?.[1]?.toLowerCase();
    const href = hrefMatch?.[1];
    if (!rel || !href) continue;
    if (rel === "modulepreload") modulePreloads.push(href);
    else if (rel === "stylesheet") stylesheets.push(href);
  }
  return { entryScripts, modulePreloads, stylesheets };
}

/** Strips a leading `/` so an href lines up with a path relative to the build's outDir. */
function relativeAssetPath(href: string): string {
  return href.startsWith("/") ? href.slice(1) : href;
}

export type GzipFn = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array;

export type ClassifyInput = {
  readonly indexHtml: string;
  /** Every file under the build's outDir except index.html and the catalog, path relative to outDir. */
  readonly files: readonly BuildFile[];
  /** The default catalog's index.json, if the build copied one in (contracts §4; warn-only budget). */
  readonly catalogIndex: BuildFile | null;
  readonly gzip: GzipFn;
  /** Files the build doesn't precache (`release.json`), paths relative to outDir: no lazy-chunk budget. */
  readonly notPrecached?: readonly string[];
};

/** Builds the size report from a build's files. Pure: the caller reads the filesystem and gzips. */
export function classifyBuild(input: ClassifyInput): SizeReport {
  const { entryScripts, modulePreloads, stylesheets } = parseIndexHtml(input.indexHtml);
  const firstLoadJsHrefs = new Set([...entryScripts, ...modulePreloads].map(relativeAssetPath));
  const firstLoadCssHrefs = new Set(stylesheets.map(relativeAssetPath));

  const byPath = new Map(input.files.map((f) => [f.path, f] as const));
  const rows: SizeRow[] = [];

  let firstLoadJsGz = 0;
  for (const href of firstLoadJsHrefs) {
    const file = byPath.get(href);
    if (file) firstLoadJsGz += input.gzip(file.bytes).byteLength;
  }
  rows.push(sizeRow("First-load JavaScript", firstLoadJsGz, BUDGETS.firstLoadJs, "gz", false));

  let cssGz = 0;
  for (const href of firstLoadCssHrefs) {
    const file = byPath.get(href);
    if (file) cssGz += input.gzip(file.bytes).byteLength;
  }
  rows.push(sizeRow("CSS", cssGz, BUDGETS.css, "gz", false));

  const fonts = input.files.filter((f) => FONT_EXTENSIONS.includes(extname(f.path).toLowerCase()));
  const fontsTotal = fonts.reduce((sum, f) => sum + f.bytes.byteLength, 0);
  const fontsOk = fonts.length <= BUDGETS.fontsCount && fontsTotal <= BUDGETS.fontsTotal;
  rows.push({
    item: `Fonts (${fonts.length} file${fonts.length === 1 ? "" : "s"})`,
    gz: null,
    raw: fontsTotal,
    budget: BUDGETS.fontsTotal,
    unit: "raw",
    warnOnly: false,
    ok: fontsOk,
  });

  if (input.catalogIndex) {
    const gz = input.gzip(input.catalogIndex.bytes).byteLength;
    rows.push(sizeRow("Catalog index", gz, BUDGETS.catalogIndex, "gz", true));
  } else {
    rows.push({ item: "Catalog index", gz: 0, raw: 0, budget: BUDGETS.catalogIndex, unit: "gz", warnOnly: true, ok: true });
  }

  const notPrecached = new Set(input.notPrecached ?? []);
  const usedPaths = new Set([...firstLoadJsHrefs, ...firstLoadCssHrefs, input.catalogIndex?.path].filter((p): p is string => p !== undefined));
  const lazyJs = input.files.filter((f) => extname(f.path) === ".js" && !usedPaths.has(f.path));
  for (const chunk of lazyJs.sort((a, b) => a.path.localeCompare(b.path))) {
    const gz = input.gzip(chunk.bytes).byteLength;
    const exempt = NO_BUDGET_PATTERN.test(basename(chunk.path)) || notPrecached.has(chunk.path);
    rows.push({
      item: `Lazy chunk ${basename(chunk.path)}${exempt ? " (no budget)" : ""}`,
      gz,
      raw: chunk.bytes.byteLength,
      budget: BUDGETS.lazyChunk,
      unit: "gz",
      warnOnly: exempt,
      ok: exempt || gz <= BUDGETS.lazyChunk,
    });
  }
  if (lazyJs.length === 0) rows.push({ item: "Lazy chunks", gz: 0, raw: 0, budget: BUDGETS.lazyChunk, unit: "gz", warnOnly: true, ok: true });

  return { rows, ok: rows.every((r) => r.warnOnly || r.ok) };
}

function sizeRow(item: string, gz: number, budget: number, unit: "gz" | "raw", warnOnly: boolean): SizeRow {
  return { item, gz, raw: gz, budget, unit, warnOnly, ok: gz <= budget };
}

function fmtKb(bytes: number): string {
  return `${(bytes / 1000).toFixed(1)} KB`;
}

/** Renders the report as a fixed-width table, one line per row, plus a status line per row over budget. */
export function renderReport(report: SizeReport): string {
  const lines: string[] = [];
  const nameWidth = Math.max(...report.rows.map((r) => r.item.length), "Item".length);
  lines.push(`${"Item".padEnd(nameWidth)}  Size        Budget      Status`);
  for (const row of report.rows) {
    const size = row.unit === "gz" ? `${fmtKb(row.gz ?? 0)} gz` : fmtKb(row.raw);
    const budget = row.unit === "gz" ? `${fmtKb(row.budget)} gz` : `${fmtKb(row.budget)}`;
    const status = row.ok ? "ok" : row.warnOnly ? "warn" : "OVER";
    lines.push(`${row.item.padEnd(nameWidth)}  ${size.padEnd(10)}  ${budget.padEnd(10)}  ${status}`);
  }
  for (const row of report.rows) {
    if (row.ok || row.warnOnly) continue;
    const over = (row.unit === "gz" ? (row.gz ?? 0) : row.raw) - row.budget;
    lines.push(`${row.item} is ${fmtKb(row.unit === "gz" ? (row.gz ?? 0) : row.raw)} ${row.unit}, ${fmtKb(over)} over its ${fmtKb(row.budget)} budget.`);
  }
  return lines.join("\n");
}
