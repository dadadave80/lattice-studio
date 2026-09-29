/**
 * Board: `design/boards/current-inspector.png` ("Inspector", row 06): a ruled spec sheet with the DiamondCut
 * plan on sunken ground, then the CreateX address. Four panels: a facet's spec rows and plan (unresolved, then
 * with its own collision), the assembly with nothing selected, and the assembly resolved and live.
 */
import { analyze, loadTemplate, type Hex } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { beforeAll, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { putDeployment } from "@/contracts";
import { InspectorPanel } from "@/panels/inspector";
import { fakeChainService, fixtureCatalog, renderWithStudio } from "../harness";

const SEPOLIA = 11155111;
const DIAMOND = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

function governedVault() {
  const loaded = loadTemplate(fixtureCatalog(), "GovernedVault");
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

/** The panel at its default pane width (spec L358's default, contracts §… `panes.inspector.size`). */
async function renderPanel(theme: "dark" | "light", project: ReturnType<typeof makeProject>, options: Parameters<typeof renderWithStudio>[1] = {}) {
  return renderWithStudio(
    <div style={{ width: 316, height: 900 }}>
      <InspectorPanel />
    </div>,
    { theme, catalog: fixtureCatalog(), project, settings: { reduceMotion: "on" }, ...options },
  );
}

function panel(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-inspector-view]");
  if (!el) throw new Error("The inspector panel isn't mounted.");
  return el;
}

describe.each(["dark", "light"] as const)("board: inspector, a facet with its plan (%s)", (theme) => {
  test("ERC4626, unresolved: source through cut, the DiamondCut plan, predicted address", async () => {
    const recipe = governedVault();
    const project = makeProject({ id: `inspector-facet-${theme}`, name: "GovernedVault", recipe });
    await renderPanel(theme, project, { session: { selection: ["ERC4626"] } });
    await expect.element(page.getByRole("heading", { level: 2, name: "ERC4626" })).toBeVisible();
    await expect.element(page.getByRole("list", { name: "Cuts in order" })).toBeVisible();
    await document.fonts.ready;
    await expect.element(page.elementLocator(panel())).toMatchScreenshot(`inspector-facet-plan-${theme}`);
  });

  test("ERC20Pausable, contested: the cut and its plan row carry the accent and ⟂ (board's own pair)", async () => {
    const base = governedVault();
    const recipe = { ...base, facets: [...base.facets, "ERC20Pausable"] };
    const project = makeProject({ id: `inspector-facet-contested-${theme}`, name: "GovernedVault", recipe });
    await renderPanel(theme, project, { session: { selection: ["ERC20Pausable"] } });
    await expect.element(page.getByRole("heading", { level: 2, name: "ERC20Pausable" })).toBeVisible();
    await document.fonts.ready;
    await expect.element(page.elementLocator(panel())).toMatchScreenshot(`inspector-facet-contested-${theme}`);
  });
});

describe.each(["dark", "light"] as const)("board: inspector, the assembly (%s)", (theme) => {
  test("nothing selected: the diamond itself, its plan and predicted address", async () => {
    const recipe = governedVault();
    const project = makeProject({ id: `inspector-assembly-${theme}`, name: "GovernedVault", recipe });
    await renderPanel(theme, project);
    await expect.element(page.getByRole("heading", { name: "GovernedVault" })).toBeVisible();
    await expect.element(page.getByRole("region", { name: "Summary" })).toBeVisible();
    await expect.element(page.getByRole("region", { name: "Deployments" })).toBeVisible();
    await document.fonts.ready;
    await expect.element(page.elementLocator(panel())).toMatchScreenshot(`inspector-assembly-${theme}`);
  });
});

describe("board: inspector, the assembly resolved and live (dark)", () => {
  test("a live deployment, nothing missing: the address takes the accent, no collision", async () => {
    // ERC20 alone has no missing init arguments and no blockers (DiamondView.browser.test.tsx: "Fill in hides
    // when no required argument is missing"), so this is genuinely resolved, not just live with a warning open.
    const loaded = loadTemplate(fixtureCatalog(), "ERC20");
    if (!loaded.ok) throw new Error(loaded.error);
    const recipe = loaded.value;
    const project = makeProject({ id: "inspector-assembly-live", name: "ERC20", recipe });
    const hash: Hex = analyze(recipe, fixtureCatalog()).recipeHash;
    await putDeployment({
      projectId: project.id, chainId: SEPOLIA, address: DIAMOND, path: "factory",
      deployer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", salt: `0x${"00".repeat(32)}`, status: "confirmed",
      recipeHash: hash, catalogHash: fixtureCatalog().hash, at: "2026-09-23T12:00:00.000Z",
      verification: "exact_match", revision: 1,
    });
    await renderPanel("dark", project, { session: { chainId: SEPOLIA }, chain: fakeChainService() });
    await expect.element(page.getByRole("region", { name: "DiamondCut plan" }).getByText("Live", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("region", { name: "Deployments" })).toBeVisible();
    await expect.element(page.getByText(/blocker/)).not.toBeInTheDocument();
    await document.fonts.ready;
    await expect.element(page.elementLocator(panel())).toMatchScreenshot("inspector-assembly-live-dark");
  });
});
