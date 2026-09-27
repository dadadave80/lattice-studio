/**
 * The font rules (spec L826): Inter variable latin with `font-display: swap` and a size-adjusted fallback ahead
 * of the system stack; JetBrains Mono 400 latin with `font-display: optional`, falling back to `ui-monospace`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appDir, repoRoot } from "../../local-env.ts";

const fontsCss = readFileSync(join(appDir, "src", "styles", "fonts.css"), "utf8");
const globalCss = readFileSync(join(appDir, "src", "styles", "global.css"), "utf8");
const tokensCss = readFileSync(join(repoRoot, "packages", "tokens", "dist", "tokens.css"), "utf8");

/** Each `@font-face` block's declarations, by property. */
function fontFaces(css: string): Record<string, string>[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => {
    const decls: Record<string, string> = {};
    for (const decl of (match[1] ?? "").split(";")) {
      const colon = decl.indexOf(":");
      if (colon > 0) decls[decl.slice(0, colon).trim()] = decl.slice(colon + 1).trim();
    }
    return decls;
  });
}

function face(family: string): Record<string, string> {
  const found = fontFaces(fontsCss).filter((f) => f["font-family"]?.replace(/"/g, "") === family);
  expect(found).toHaveLength(1);
  return found[0] ?? {};
}

/** The families in a custom property's value, in order, unquoted. */
function stack(css: string, property: string): string[] {
  const match = new RegExp(`${property}:\\s*([^;]+);`).exec(css);
  if (!match?.[1]) throw new Error(`No ${property} declaration.`);
  return match[1].split(",").map((family) => family.trim().replace(/"/g, ""));
}

describe("fonts (spec L826)", () => {
  test("Inter variable latin swaps in, over a size-adjusted fallback", () => {
    const inter = face("Inter");
    expect(inter["font-display"]).toBe("swap");
    expect(inter["font-weight"]).toBe("100 900");
    expect(inter.src).toContain("inter-latin-wght-normal.woff2");
    const fallback = face("Inter Fallback");
    expect(fallback.src).toMatch(/^local\(/);
    expect(fallback["size-adjust"]).toMatch(/^\d+(\.\d+)?%$/);
    expect(fallback["size-adjust"]).not.toBe("100%");
    // The fallback comes right after Inter, ahead of the system stack.
    expect(stack(globalCss, "--lx-font-sans").slice(0, 3)).toEqual(["Inter", "Inter Fallback", "system-ui"]);
  });

  test("JetBrains Mono 400 latin is optional, falling back to ui-monospace", () => {
    const mono = face("JetBrains Mono");
    expect(mono["font-display"]).toBe("optional");
    expect(mono["font-weight"]).toBe("400");
    expect(mono.src).toContain("jetbrains-mono-latin-400-normal.woff2");
    expect(stack(tokensCss, "--lx-font-mono").slice(0, 2)).toEqual(["JetBrains Mono", "ui-monospace"]);
  });
});
