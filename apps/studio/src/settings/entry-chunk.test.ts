/**
 * Build check (spec L822): Settings loads in its own chunk, opened on first use, not the entry (contracts
 * §6, this WP's Done-when). Builds the app with plain `bun run build` (`scripts/ci/size.ts`'s own path) into
 * the app's normal `dist/`, then reads what the first load fetches (`<script type="module">` and
 * `<link rel="modulepreload">` only, the same way `scripts/ci/size.ts` classifies "first-load JavaScript")
 * and what the lazy chunks carry, the same way `apps/studio/src/chain/infra/entry-chunk.test.ts` does for the
 * chain module.
 *
 * The tour and the banner host are checked differently, below: `App.tsx` mounts `<Tour/>` and `Shell.tsx`
 * mounts `<BannerHost/>` (at the top of the sheet region) unconditionally, and this repo has seen the build's rolldown codeSplitting group (FX17)
 * disagree, run to run, on whether a chunk that tiny and that close to the entry's own graph stays out of it
 * — including runs of this very build spawned from inside `bun test`, which don't reproduce what
 * `bun run build` or `scripts/ci/size.ts --build` produce outside one. A static import-graph check (the
 * technique `apps/studio/src/palette/chunk.test.ts` uses) proves the property that actually matters
 * regardless of how the bundler's heuristic lands on a given run: neither eager entry point's own static
 * imports (not a dynamic `import()`) ever reach `@/ui`, so nothing bundler-side can pull `Button` or `Banner`
 * in ahead of the moment either component is actually needed.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseIndexHtml } from "../../../../scripts/ci/size-logic";
import { appDir, repoRoot } from "../../local-env";

/** A string only Settings → Keyboard's UI carries (its "Reset all shortcuts" button). */
const SETTINGS_MARKER = "Reset all shortcuts";

let firstLoad = "";
let lazy: string[] = [];

beforeAll(() => {
  const result = Bun.spawnSync(["bun", "run", "build"], { cwd: repoRoot });
  if (result.exitCode !== 0) {
    throw new Error(`bun run build failed (exit ${result.exitCode}): ${result.stderr.toString()}`);
  }
  const out = join(appDir, "dist");
  const html = readFileSync(join(out, "index.html"), "utf8");
  const { entryScripts, modulePreloads } = parseIndexHtml(html);
  const first = [...new Set([...entryScripts, ...modulePreloads])].map((href) => (href.startsWith("/") ? href.slice(1) : href));
  expect(first.length).toBeGreaterThan(0);
  firstLoad = first.map((path) => readFileSync(join(out, path), "utf8")).join("\n");
  lazy = readdirSync(join(out, "assets"))
    .filter((name) => name.endsWith(".js") && !first.includes(`assets/${name}`))
    .map((name) => readFileSync(join(out, "assets", name), "utf8"));
}, 120_000);

describe("Settings' chunk", () => {
  test("the entry chunk doesn't carry Settings' UI", () => {
    expect(firstLoad.includes(SETTINGS_MARKER)).toBe(false);
  });

  test("a lazy chunk does, so it's still reachable, just not at first paint", () => {
    expect(lazy.some((chunk) => chunk.includes(SETTINGS_MARKER))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The tour and the banner host: a static import-graph check (see the module doc above).

/** Value imports and re-exports (not `import type`), as written. */
function staticImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  const pattern = /^(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)"|^import\s+"([^"]+)"/gm;
  for (const match of source.matchAll(pattern)) found.push(match[1] ?? match[2] ?? "");
  return found;
}

/** Resolves a relative specifier to a file on disk; leaves aliased (`@/...`) and bare specifiers alone. */
function resolveLocal(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = join(dirname(from), specifier);
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    try {
      readFileSync(base + ext);
      return base + ext;
    } catch {
      // Try the next extension.
    }
  }
  return null;
}

/** Every file and package the entry points reach through static (never dynamic) imports. */
function reach(entryAbsPaths: string[]): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [...entryAbsPaths];
  while (queue.length) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of staticImports(file)) {
      const local = resolveLocal(file, specifier);
      if (local) queue.push(local);
      else packages.add(specifier);
    }
  }
  return { files, packages };
}

const src = join(appDir, "src");

describe("the tour's chunk (static, see the module doc above)", () => {
  const entry = reach([join(src, "tour", "index.ts"), join(src, "tour", "TourChunk.tsx")]);

  test("App.tsx's eager `<Tour/>` mount never statically reaches @/ui or Tour.tsx itself", () => {
    expect([...entry.packages].some((p) => p === "@/ui" || p.startsWith("@/ui/"))).toBe(false);
    expect([...entry.files].some((f) => f.endsWith(`${join("tour", "Tour.tsx")}`))).toBe(false);
  });

  test("Tour.tsx (only reached through TourChunk's import()) does use @/ui", () => {
    expect(staticImports(join(src, "tour", "Tour.tsx")).some((s) => s === "@/ui")).toBe(true);
  });
});

describe("the banner host's chunk (static, see the module doc above)", () => {
  const entry = reach([
    join(src, "feedback", "index.ts"),
    join(src, "feedback", "BannerHostChunk.tsx"),
    join(src, "feedback", "services.ts"),
  ]);

  test("Shell.tsx's eager <BannerHost/> mount never statically reaches @/ui or BannerHost.tsx itself", () => {
    expect([...entry.packages].some((p) => p === "@/ui" || p.startsWith("@/ui/"))).toBe(false);
    expect([...entry.files].some((f) => f.endsWith(join("feedback", "BannerHost.tsx")))).toBe(false);
  });

  test("BannerHost.tsx (only reached through BannerHostChunk's import()) does use @/ui", () => {
    expect(staticImports(join(src, "feedback", "BannerHost.tsx")).some((s) => s === "@/ui")).toBe(true);
  });
});
