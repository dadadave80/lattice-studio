import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { kebab } from "./render-css.ts";
import { LAYOUT_CSS_LENGTH_KEYS, layoutSizes } from "./layout.ts";
import { renderCss } from "./render-css.ts";
import { renderReadme } from "./render-readme.ts";
import { renderShikiTheme } from "./render-shiki.ts";
import { renderTokensTs } from "./render-ts.ts";
import { parseTokensJson } from "./tokens-json.ts";

const PACKAGE_DIR = resolve(new URL(".", import.meta.url).pathname, "..");
const VENDORED_TOKENS_JSON = resolve(PACKAGE_DIR, "tokens.json");
const DIST_DIR = resolve(PACKAGE_DIR, "dist");

async function loadJson() {
  return parseTokensJson(await Bun.file(VENDORED_TOKENS_JSON).text());
}

describe("build output is byte-identical across two runs", () => {
  test("tokens.css", async () => {
    const json = await loadJson();
    expect(renderCss(json)).toBe(renderCss(json));
  });

  test("tokens.ts", async () => {
    const json = await loadJson();
    expect(renderTokensTs(json)).toBe(renderTokensTs(json));
  });

  test("shiki themes", () => {
    expect(renderShikiTheme("shop")).toBe(renderShikiTheme("shop"));
    expect(renderShikiTheme("draft")).toBe(renderShikiTheme("draft"));
  });

  test("README", () => {
    expect(renderReadme()).toBe(renderReadme());
  });

  test("a second parse of the same source produces the same output", async () => {
    const source = await Bun.file(VENDORED_TOKENS_JSON).text();
    const first = renderCss(parseTokensJson(source));
    const second = renderCss(parseTokensJson(source));
    expect(first).toBe(second);
  });
});

describe("tokens.css structure", () => {
  test("defines both theme blocks and every role", async () => {
    const css = renderCss(await loadJson());
    expect(css).toContain(':root[data-theme="shop"]');
    expect(css).toContain(':root[data-theme="draft"]');
    for (const role of [
      "ground",
      "ground-well",
      "panel",
      "raised",
      "sunken",
      "text",
      "text-muted",
      "text-faint",
      "border",
      "border-subtle",
      "border-strong",
      "border-focus",
      "accent",
      "accent-strong",
      "on-accent",
      "accent-soft",
      "accent-line",
      "dot",
      "hatch",
    ]) {
      expect(css).toContain(`--lx-${role}:`);
    }
  });

  test("has forced-colors and prefers-contrast blocks", async () => {
    const css = renderCss(await loadJson());
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media (prefers-contrast: more)");
  });

  test("radius is square (0px) everywhere", async () => {
    const css = renderCss(await loadJson());
    expect(css).toContain("--lx-radius: 0px;");
  });

  test("every length in layoutSizes appears as a var(--lx-*), with the same value (contracts.md §5.4)", async () => {
    const css = renderCss(await loadJson());
    for (const key of LAYOUT_CSS_LENGTH_KEYS) {
      expect(css).toContain(`--lx-${kebab(key)}: ${layoutSizes[key]}px;`);
    }
  });
});

describe("dist/* matches a fresh render from the vendored tokens.json (drift check)", () => {
  test("tokens.css", async () => {
    const json = await loadJson();
    const fresh = renderCss(json);
    const committed = await Bun.file(resolve(DIST_DIR, "tokens.css")).text();
    expect(fresh).toBe(committed);
  });

  test("tokens.ts", async () => {
    const json = await loadJson();
    const fresh = renderTokensTs(json);
    const committed = await Bun.file(resolve(DIST_DIR, "tokens.ts")).text();
    expect(fresh).toBe(committed);
  });

  test("shiki-shop.json", async () => {
    const fresh = renderShikiTheme("shop");
    const committed = await Bun.file(resolve(DIST_DIR, "shiki-shop.json")).text();
    expect(fresh).toBe(committed);
  });

  test("shiki-draft.json", async () => {
    const fresh = renderShikiTheme("draft");
    const committed = await Bun.file(resolve(DIST_DIR, "shiki-draft.json")).text();
    expect(fresh).toBe(committed);
  });

  test("README.md", async () => {
    const fresh = renderReadme();
    const committed = await Bun.file(resolve(PACKAGE_DIR, "README.md")).text();
    expect(fresh).toBe(committed);
  });
});

describe("tokens.ts structure", () => {
  test("is valid TypeScript the package can type-check (parses without throwing)", async () => {
    const ts = renderTokensTs(await loadJson());
    expect(ts).toContain("export const themeColors");
    expect(ts).toContain("export const layoutSizes");
    expect(ts).toContain('"shop"');
    expect(ts).toContain('"draft"');
  });
});

describe("shiki themes", () => {
  test("are valid JSON scoped to shop=dark, draft=light", () => {
    const shop = JSON.parse(renderShikiTheme("shop")) as { type: string };
    const draft = JSON.parse(renderShikiTheme("draft")) as { type: string };
    expect(shop.type).toBe("dark");
    expect(draft.type).toBe("light");
  });
});
