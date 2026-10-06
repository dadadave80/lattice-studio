/**
 * index.html's critical CSS duplicates a few tokens and shell sizes because it has to render before
 * packages/tokens/dist/tokens.css and the real Shell load (see the comment at the top of that `<style>`
 * block). This guards the duplication: every `--lxs-*` value must equal its `--lx-*` counterpart per theme
 * (contracts §1 T1), every hard-coded pane or tier size must equal Shell's own constants (contracts §1
 * S3: shell/panes.ts PANE_SIZES, shell/layout-tier.ts TIER_MIN), and the static Start block must say what
 * sheet/chrome/StartBlock.tsx says.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appDir, repoRoot } from "../../local-env.ts";
import { PANE_SIZES } from "../shell/panes.ts";
import { TIER_MIN } from "../shell/layout-tier.ts";

const indexHtml = readFileSync(join(appDir, "index.html"), "utf8");
const tokensCss = readFileSync(join(repoRoot, "packages", "tokens", "dist", "tokens.css"), "utf8");

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The custom properties declared directly inside the first `selector { … }` block in `css` (no nesting). */
function block(css: string, selector: string): Record<string, string> {
  const match = new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match?.[1]) throw new Error(`No ${selector} block in the given CSS.`);
  const vars: Record<string, string> = {};
  for (const decl of match[1].split(";")) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim();
    if (prop.startsWith("--")) vars[prop] = decl.slice(colon + 1).trim();
  }
  return vars;
}

/** So "0.12" and ".12", "#0C0D0F" and "#0c0d0f", and "233, 231, 225" and "233,231,225" compare equal. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/(?<!\d)0\.(\d)/g, ".$1");
}

/** One `--lxs-*` (index.html) against the `--lx-*` it stands in for (tokens.css), in the same theme. */
function expectSameValue(
  criticalVars: Record<string, string>,
  tokenVars: Record<string, string>,
  lxsName: string,
  lxName: string,
): void {
  const critical = criticalVars[lxsName];
  const token = tokenVars[lxName];
  expect(critical, `index.html's critical CSS has no ${lxsName}`).toBeDefined();
  expect(token, `tokens.css has no ${lxName}`).toBeDefined();
  expect(normalize(critical ?? ""), `${lxsName} (${critical}) should equal ${lxName} (${token})`).toBe(
    normalize(token ?? ""),
  );
}

describe("critical CSS token values match tokens.css", () => {
  const criticalRoot = block(indexHtml, ":root");
  const tokensRoot = block(tokensCss, ":root");

  test("space and stroke", () => {
    expectSameValue(criticalRoot, tokensRoot, "--lxs-space-1", "--lx-space-1");
    expectSameValue(criticalRoot, tokensRoot, "--lxs-space-2", "--lx-space-2");
    expectSameValue(criticalRoot, tokensRoot, "--lxs-space-8", "--lx-space-8");
    expectSameValue(criticalRoot, tokensRoot, "--lxs-stroke-hair", "--lx-stroke-hair");
  });

  test("the Start block's space, radius, card width and label tracking", () => {
    for (const step of [3, 4, 6, 12]) expectSameValue(criticalRoot, tokensRoot, `--lxs-space-${step}`, `--lx-space-${step}`);
    expectSameValue(criticalRoot, tokensRoot, "--lxs-radius", "--lx-radius");
    expectSameValue(criticalRoot, tokensRoot, "--lxs-card-width", "--lx-card-width");
    expectSameValue(criticalRoot, tokensRoot, "--lxs-tracking-label", "--lx-tracking-label");
  });

  for (const theme of ["dark", "light"] as const) {
    test(`colors, ${theme}`, () => {
      const criticalTheme = block(indexHtml, `:root[data-theme="${theme}"]`);
      const tokensTheme = block(tokensCss, `:root[data-theme="${theme}"]`);
      expectSameValue(criticalTheme, tokensTheme, "--lxs-ground", "--lx-ground");
      expectSameValue(criticalTheme, tokensTheme, "--lxs-panel", "--lx-panel");
      expectSameValue(criticalTheme, tokensTheme, "--lxs-sunken", "--lx-sunken");
      expectSameValue(criticalTheme, tokensTheme, "--lxs-text", "--lx-text");
      expectSameValue(criticalTheme, tokensTheme, "--lxs-border-subtle", "--lx-border-subtle");
      expectSameValue(criticalTheme, tokensTheme, "--lxs-text-muted", "--lx-text-muted");
      expectSameValue(criticalTheme, tokensTheme, "--lxs-text-faint", "--lx-text-faint");
      expectSameValue(criticalTheme, tokensTheme, "--lxs-border", "--lx-border");
    });
  }
});

describe("critical CSS pane and tier sizes match the shell's", () => {
  test("the left pane's width is PANE_SIZES.left.initial", () => {
    const width = /\.lxs-pane--left\s*\{[^}]*inline-size:\s*(\d+)px/.exec(indexHtml)?.[1];
    expect(width && Number(width)).toBe(PANE_SIZES.left.initial);
  });

  test("the inspector's width is PANE_SIZES.inspector.initial", () => {
    const width = /\.lxs-pane--inspector\s*\{[^}]*inline-size:\s*(\d+)px/.exec(indexHtml)?.[1];
    expect(width && Number(width)).toBe(PANE_SIZES.inspector.initial);
  });

  test("the console body's height is PANE_SIZES.console.initial", () => {
    const height = /--lxs-space-1\)\s*\+\s*(\d+)px\)/.exec(indexHtml)?.[1];
    expect(height && Number(height)).toBe(PANE_SIZES.console.initial);
  });

  test("the side panes show from TIER_MIN.wide", () => {
    const min = /@media \(min-width:\s*(\d+)px\)/.exec(indexHtml)?.[1];
    expect(min && Number(min)).toBe(TIER_MIN.wide);
  });

  test("the console hides below TIER_MIN.narrow", () => {
    const max = /@media \(max-width:\s*(\d+)px\)/.exec(indexHtml)?.[1];
    expect(max && Number(max)).toBe(TIER_MIN.narrow - 1);
  });

  // space-8 + space-1 is PANE_SIZES.console.header, as in the console's own rule (Shell.module.css).
  test("the console is its header alone from TIER_MIN.narrow to TIER_MIN.mid", () => {
    const tier = /@media \(min-width:\s*(\d+)px\) and \(max-width:\s*(\d+)px\)\s*\{\s*\.lxs-console\s*\{\s*block-size:\s*calc\(var\(--lxs-space-8\) \+ var\(--lxs-space-1\)\);/.exec(
      indexHtml,
    );
    expect(tier && [Number(tier[1]), Number(tier[2])]).toEqual([TIER_MIN.narrow, TIER_MIN.mid - 1]);
  });
});

describe("the static Start block says what the real one says", () => {
  const start = /<section class="lxs-start"[\s\S]*?<\/section>/.exec(indexHtml)?.[0] ?? "";
  const texts = [...start.matchAll(/>([^<>]+)</g)].map((m) => m[1]?.trim()).filter((t): t is string => Boolean(t));

  test("the title, the choices and the hints, in the block's order", async () => {
    const copy = await import("../sheet/chrome/copy.ts");
    const recipes = copy.START_RECIPES.flatMap((name) => [name, copy.RECIPE_BLURBS[name] ?? ""]);
    expect(texts).toEqual([
      copy.START_A_DIAMOND, copy.BLANK_DIAMOND_LABEL, copy.BLANK_DIAMOND_ADDS, ...recipes, copy.BROWSE_ALL_RECIPES,
      copy.startHint("Ctrl+K"), copy.TOUR_PROMPT, copy.TOUR_LINK,
    ]);
  });
});
