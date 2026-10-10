/**
 * The theme before first paint (index.html's inline script): a Light visitor's first frame is Light, not the
 * dark fallback, and the PWA's theme-color follows the scheme.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { themeColors } from "@lattice-studio/tokens";
import { appDir } from "../local-env.ts";
import { iconTags } from "./pwa.ts";

const html = readFileSync(join(appDir, "index.html"), "utf8");

/** The classic inline scripts in `<head>`, in order. */
function headScripts(): string[] {
  const head = html.slice(0, html.indexOf("</head>"));
  return [...head.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(([, body = ""]) => body);
}

type World = { stored?: string | null; storageThrows?: boolean; prefersDark?: boolean; noMatchMedia?: boolean };

/** Runs the head scripts against a stub page and returns the `data-theme` they leave. */
function firstTheme(world: World): string {
  const attrs: Record<string, string> = { "data-theme": "dark" };
  const document = { documentElement: { setAttribute: (name: string, value: string) => (attrs[name] = value) } };
  const localStorage = {
    getItem: () => {
      if (world.storageThrows) throw new Error("SecurityError");
      return world.stored ?? null;
    },
  };
  const matchMedia = world.noMatchMedia
    ? undefined
    : (query: string) => ({ matches: query === "(prefers-color-scheme: dark)" ? (world.prefersDark ?? true) : false });
  for (const body of headScripts()) new Function("document", "localStorage", "matchMedia", body)(document, localStorage, matchMedia);
  return attrs["data-theme"] ?? "";
}

const saved = (theme: string): string => JSON.stringify({ theme });

describe("index.html sets the theme before first paint", () => {
  test("a first visit follows the system: Light for a Light OS, Dark for a Dark one", () => {
    expect(firstTheme({ prefersDark: false })).toBe("light");
    expect(firstTheme({ prefersDark: true })).toBe("dark");
  });

  test("a saved choice wins over the system", () => {
    expect(firstTheme({ stored: saved("dark"), prefersDark: false })).toBe("dark");
    expect(firstTheme({ stored: saved("light"), prefersDark: true })).toBe("light");
    expect(firstTheme({ stored: saved("system"), prefersDark: false })).toBe("light");
  });

  test("themes saved before the rename read as the themes they became", () => {
    expect(firstTheme({ stored: saved("draft"), prefersDark: true })).toBe("light");
    expect(firstTheme({ stored: saved("shop"), prefersDark: false })).toBe("dark");
  });

  test("blocked storage or a broken entry still follows the system; no matchMedia keeps Dark", () => {
    expect(firstTheme({ storageThrows: true, prefersDark: false })).toBe("light");
    expect(firstTheme({ stored: "{not json", prefersDark: false })).toBe("light");
    expect(firstTheme({ stored: "null", prefersDark: false })).toBe("light");
    expect(firstTheme({ stored: saved("neon"), prefersDark: false })).toBe("light");
    expect(firstTheme({ noMatchMedia: true })).toBe("dark");
  });

  test("the script is classic, not a module, so it runs before the body paints", () => {
    expect(html).toMatch(/<head>[\s\S]*<script>[\s\S]*data-theme[\s\S]*<\/script>[\s\S]*<\/head>/);
  });
});

describe("theme-color", () => {
  test("each scheme gets its own ground", () => {
    const metas = iconTags("/").filter((tag) => tag.tag === "meta" && tag.attrs?.["name"] === "theme-color");
    expect(metas.map((tag) => tag.attrs)).toEqual([
      { name: "theme-color", media: "(prefers-color-scheme: light)", content: themeColors.light.ground },
      { name: "theme-color", media: "(prefers-color-scheme: dark)", content: themeColors.dark.ground },
    ]);
    expect(themeColors.light.ground.toUpperCase()).toBe("#F3F1E9");
  });
});
