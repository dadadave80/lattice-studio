/**
 * Board: `design/boards/current-title-block.png` ("Title block", row 08). Unresolved, predicted and live, in
 * both themes: the project card bottom right of the sheet, Deploy the one filled primary, disabled while a
 * collision is unresolved (spec L362, L378-L389).
 *
 * Provisional: the collapsed and strip forms carry no board (`TitleBlockForm`, S4d) — listed for David's design
 * pass in the README.
 */
import type { Analysis, Hex } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { beforeAll, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { emptyAnalysis, provideAnalysis, putDeployment } from "@/contracts";
import { ALICE, deployableCatalog, SEPOLIA, account } from "@/chain/review/test-support";
import { resetTitleBlockCollapse, TitleBlockContent, type TitleBlockForm } from "@/sheet/chrome/TitleBlock";
import { fakeChainService, onCleanup, renderWithStudio, type StudioOptions } from "../harness";

const HASH: Hex = `0x${"ab".repeat(32)}`;
const DIAMOND = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const block = () => page.getByRole("region", { name: "Title block" });

function useAnalysisOf(patch: Partial<Analysis>): void {
  const analysis = { ...emptyAnalysis(), recipeHash: HASH, ...patch };
  onCleanup(provideAnalysis({ getAnalysis: () => analysis, subscribe: () => () => undefined }));
}

function placed() {
  return makeProject({ name: "GovernedVault", recipe: makeRecipe({ facets: ["ERC20"] }, deployableCatalog()) });
}

async function renderBlock(options: StudioOptions & { form?: TitleBlockForm } = {}) {
  resetTitleBlockCollapse();
  const { form, ...rest } = options;
  return renderWithStudio(
    <div style={{ width: 360 }}>
      <TitleBlockContent {...(form ? { form } : {})} />
    </div>,
    { catalog: deployableCatalog(), project: placed(), settings: { reduceMotion: "on" }, ...rest },
  );
}

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

describe.each(["shop", "draft"] as const)("board: title block (%s)", (theme) => {
  test("unresolved: two collisions, Deploy disabled", async () => {
    useAnalysisOf({ problems: [{ id: "SEL-01:0", code: "SEL-01", severity: "blocker", where: [{ kind: "diamond" }], params: {}, message: "", fixes: [] }] });
    fakeChainService({ account: account() }).install();
    await renderBlock({ theme, session: { chainId: SEPOLIA } });
    await expect.element(block().getByText("1 blocker")).toBeVisible();
    await expect.element(block().getByRole("button", { name: /^Deploy…/ })).toHaveAttribute("aria-disabled", "true");
    await document.fonts.ready;
    await expect.element(page.elementLocator(block().element() as HTMLElement)).toMatchScreenshot(`title-block-unresolved-${theme}`);
  });

  test("predicted: the CreateX address, Deploy enabled", async () => {
    useAnalysisOf({});
    fakeChainService({ account: account() }).install();
    await renderBlock({ theme, session: { chainId: SEPOLIA } });
    await expect.element(block().getByText("Predicted")).toBeVisible();
    await expect.element(block().getByRole("button", { name: "Deploy…" })).not.toHaveAttribute("aria-disabled");
    await document.fonts.ready;
    await expect.element(page.elementLocator(block().element() as HTMLElement)).toMatchScreenshot(`title-block-predicted-${theme}`);
  });

  test("live: the deployed address, linked, Deploy again…", async () => {
    useAnalysisOf({});
    await putDeployment({
      projectId: "test-project", chainId: SEPOLIA, address: DIAMOND, path: "factory", deployer: ALICE,
      salt: `0x${"00".repeat(32)}`, status: "confirmed", recipeHash: HASH, catalogHash: HASH,
      at: "2026-09-23T12:00:00.000Z", verification: "exact_match", revision: 1,
    });
    await renderBlock({ theme, session: { chainId: SEPOLIA }, chain: true });
    await expect.element(block().getByText("Live · Sepolia · r1")).toBeVisible();
    await document.fonts.ready;
    await expect.element(page.elementLocator(block().element() as HTMLElement)).toMatchScreenshot(`title-block-live-${theme}`);
  });
});

describe.each(["shop", "draft"] as const)("provisional: title block forms with no board (%s)", (theme) => {
  test("collapsed: one row, stamp and short address", async () => {
    useAnalysisOf({});
    fakeChainService({ account: account() }).install();
    await renderBlock({ theme, session: { chainId: SEPOLIA } });
    await block().getByRole("button", { name: "Collapse title block" }).click();
    await expect.element(block()).toHaveAttribute("data-form", "collapsed");
    await document.fonts.ready;
    await expect.element(page.elementLocator(block().element() as HTMLElement)).toMatchScreenshot(`provisional-title-block-collapsed-${theme}`);
  });

  test("strip: 768-1023 px, no Deploy button", async () => {
    useAnalysisOf({});
    fakeChainService({ account: account() }).install();
    await renderBlock({ theme, form: "strip", session: { chainId: SEPOLIA } });
    await expect.element(block().getByText("Not deployed")).toBeVisible();
    await expect.element(page.getByRole("button", { name: /^Deploy/ })).not.toBeInTheDocument();
    await document.fonts.ready;
    await expect.element(page.elementLocator(block().element() as HTMLElement)).toMatchScreenshot(`provisional-title-block-strip-${theme}`);
  });
});
