/**
 * Screenshot baselines (brief S4a): every pin state and every border, in Shop and Draft and with forced colors;
 * hover; the compact form; focus. And axe on the same sheet. The gallery (see `testing/projects.ts`):
 *
 * - ERC20: routed, not in the diamond (symbol), served elsewhere (name → GovernedVault), seams that stay on
 *   GovernedVault; conflict (SEM-01 on decimals).
 * - ERC20Votes: selected, with a "Not on Base Sepolia" chip; default border.
 * - GovernedVault: pins on the right, expanded (Collapse), owner by default (name, CLOCK_MODE and clock), seams
 *   it serves; caution (a convention).
 * - ERC20Pausable: both pins seams elsewhere; caution (cuts nothing).
 * - AxelarGatewayAdapter and HyperlaneGatewayAdapter: contested pins, conflict; Hyperlane collapsed with
 *   "+ 6 more" keeping its contested rows.
 * - VaultCore: a missing dependency, caution. Receive: default, "no storage".
 */
import { analyze, type Analysis, type Hex4, type Problem, type Recipe } from "@lattice-studio/core";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { doc, provideAnalysis } from "@/contracts";
import { axeViolations, emulateForcedColors } from "@/ui/testing/axe";
import { fixtureCatalog, onCleanup, renderWithStudio } from "../../../test/harness";
import { CardSheet } from "./testing/CardSheet";
import { cardProject, GALLERY_FACETS } from "./testing/projects";

const catalog = fixtureCatalog();
const SYMBOL: Hex4 = "0x95d89b41";

const NOT_ON_CHAIN: Problem = {
  id: "NET-03", code: "NET-03", severity: "blocker", where: [{ kind: "chain", chainId: 84532 }],
  params: { chain: "Base Sepolia", core: [], missing: ["ERC20Votes"], total: 8 }, message: "", fixes: [],
};

/** The analysis, plus a NET-03 naming ERC20Votes, so the chip shows (the chain module isn't in these tests). */
function withChip(): void {
  let cache: { recipe: Recipe; analysis: Analysis } | null = null;
  onCleanup(
    provideAnalysis({
      getAnalysis() {
        const recipe = doc.get().recipe;
        if (cache?.recipe !== recipe) {
          const analysis = analyze(recipe, catalog);
          cache = { recipe, analysis: { ...analysis, problems: [...analysis.problems, NOT_ON_CHAIN] } };
        }
        return cache.analysis;
      },
      subscribe: (listener) => doc.subscribe(() => listener()),
    }),
  );
}

// JetBrains Mono is `font-display: optional`: load both faces before any card renders, or a baseline taken
// before the font arrived uses the fallback and later runs differ.
beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

afterEach(async () => {
  await emulateForcedColors(false);
});

function sheetElement(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-region="sheet"]');
  if (!el) throw new Error("No sheet.");
  return el;
}

function card(facet: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-facet="${facet}"]`);
  if (!el) throw new Error(`No card for ${facet}.`);
  return el;
}

async function gallery(theme: "shop" | "draft", zoom = 1) {
  withChip();
  const project = cardProject(catalog, GALLERY_FACETS, {
    exclude: [SYMBOL], pinsRight: ["GovernedVault"], expanded: ["GovernedVault"],
  });
  await renderWithStudio(<CardSheet zoom={zoom} />, {
    project, theme, session: { selection: ["ERC20Votes"] }, settings: { reduceMotion: "on" },
  });
  await expect.poll(() => document.querySelectorAll("[data-facet]").length).toBe(GALLERY_FACETS.length);
  await document.fonts.ready;
}

describe.each(["shop", "draft"] as const)("%s", (theme) => {
  test("every pin state and border", async () => {
    await gallery(theme);
    expect(card("ERC20Votes").textContent).toContain("Not on Base Sepolia");
    await expect.element(page.elementLocator(sheetElement())).toMatchScreenshot(`gallery-${theme}`);
  });

  test("every pin state and border with forced colors", async () => {
    await gallery(theme);
    await emulateForcedColors(true);
    expect(matchMedia("(forced-colors: active)").matches).toBe(true);
    await expect.element(page.elementLocator(sheetElement())).toMatchScreenshot(`gallery-forced-${theme}`);
  });

  test("hover thickens the rule", async () => {
    await gallery(theme);
    const receive = card("Receive");
    const header = receive.querySelector<HTMLElement>("[class*='header']");
    if (!header) throw new Error("No header.");
    const rest = getComputedStyle(receive, "::after").borderTopColor;
    await userEvent.hover(header);
    await expect.poll(() => getComputedStyle(receive, "::after").borderTopColor).not.toBe(rest);
    await expect.element(page.elementLocator(receive.parentElement ?? receive)).toMatchScreenshot(`hover-${theme}`);
  });

  test("focus rings on the card and on a pin row", async () => {
    await gallery(theme);
    const node = document.querySelector<HTMLElement>('.react-flow__node[data-id="Receive"]');
    if (!node) throw new Error("No node.");
    // A key press first, so programmatic focus shows the keyboard ring (:focus-visible), as S4e's roving does.
    await userEvent.keyboard("{Shift}");
    node.focus();
    expect(document.activeElement).toBe(node);
    expect(node.matches(":focus-visible")).toBe(true);
    await expect
      .poll(() => {
        const ring = getComputedStyle(node);
        return [ring.outlineStyle, ring.outlineWidth, ring.outlineOffset];
      })
      .toEqual(["solid", "2px", "2px"]);
    await expect.element(page.elementLocator(sheetElement())).toMatchScreenshot(`focus-card-${theme}`);
    const pin = card("ERC20").querySelector<HTMLElement>('[data-selector="0xdd62ed3e"]');
    pin?.focus();
    expect(pin?.matches(":focus-visible")).toBe(true);
    // Focus may open the pin's tooltip; Esc closes it (the pin keeps focus), so the baseline shows the ring alone.
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[data-tooltip]")).toBeNull();
    expect(document.activeElement).toBe(pin);
    await expect.element(page.elementLocator(card("ERC20"))).toMatchScreenshot(`focus-pin-${theme}`);
  });

  test("compact below 40%", async () => {
    await gallery(theme, 0.35);
    await expect.poll(() => card("ERC20").dataset.compact).toBe("");
    await expect.element(page.elementLocator(sheetElement())).toMatchScreenshot(`compact-${theme}`);
  });

  test("axe finds nothing on the gallery", async () => {
    await gallery(theme);
    // Pin rows stay 20 px for density; their 24 px equivalents are the inspector's Selectors rows (spec L770).
    expect(await axeViolations(sheetElement(), { rules: { "target-size": { enabled: false } } })).toEqual([]);
  });

  test("axe finds nothing on the gallery with forced colors", async () => {
    await gallery(theme);
    await emulateForcedColors(true);
    expect(await axeViolations(sheetElement(), { forced: true, rules: { "target-size": { enabled: false } } })).toEqual([]);
  });
});
