/**
 * Board: `design/boards/current-console.png`. All resolved, collisions and the Script/Recipe JSON tabs (PA
 * L81 lists these tabs as not designed yet, but the current-console board already draws them - see the
 * README's "Differences from the boards" section).
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { emptyAnalysis, log, provideAnalysis } from "@/contracts";
import { ConsolePanel } from "@/panels/console/ConsolePanel";
import { awaitConsoleBody, collisionProject, erc20Project, resetConsole } from "@/panels/console/test-support";
import { onCleanup, renderWithStudio } from "../harness";

const consoleRegion = () => document.querySelector<HTMLElement>("[data-keyctx='console']");

beforeEach(() => resetConsole());

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

function noProblems(): void {
  const analysis = { ...emptyAnalysis(), problems: [] };
  onCleanup(provideAnalysis({ getAnalysis: () => analysis, subscribe: () => () => undefined }));
}

async function renderConsole(project = erc20Project(), options: { theme?: "dark" | "light" } = {}) {
  await renderWithStudio(
    <div style={{ width: 900, height: 260, display: "flex" }}>
      <ConsolePanel />
    </div>,
    { project, settings: { reduceMotion: "on" }, ...(options.theme ? { theme: options.theme } : {}) },
  );
  await awaitConsoleBody();
}

async function shoot(name: string): Promise<void> {
  await document.fonts.ready;
  const el = consoleRegion();
  if (!el) throw new Error("No console region.");
  await expect.element(page.elementLocator(el)).toMatchScreenshot(name);
}

describe.each(["dark", "light"] as const)("board: console, all resolved (%s)", (theme) => {
  test("Log tab, 0 collisions", async () => {
    noProblems();
    await renderConsole(erc20Project(), { theme });
    await expect.element(page.getByText("No problems")).toBeVisible();
    await expect.element(page.getByRole("log", { name: "Log" })).toBeVisible();
    await shoot(`console-resolved-${theme}`);
  });
});

describe.each(["dark", "light"] as const)("board: console, collisions (%s)", (theme) => {
  test("Log tab, a SEL-01 collision logged", async () => {
    await renderConsole(collisionProject(), { theme });
    await expect.element(page.getByText("2 blockers", { exact: false })).toBeVisible();
    log({ tag: "Note", text: "Loaded 16 facets · 123 selectors routed." });
    log({
      tag: "Collision",
      text:
        "AxelarGatewayAdapter and HyperlaneGatewayAdapter both export `sendMessage · 0xcdfe7f5c`. Choose an owner.",
      anchor: { kind: "selector", selector: "0xcdfe7f5c", facet: "AxelarGatewayAdapter" },
    });
    await expect.poll(() => document.querySelectorAll("[data-line-id]").length).toBe(2);
    await shoot(`console-collisions-${theme}`);
  });
});

describe("board: console, code tabs", () => {
  test("Script tab, dark only (cheap: no theme-dependent syntax highlighting difference expected)", async () => {
    await renderConsole(erc20Project(), { theme: "dark" });
    await page.getByRole("tab", { name: "Script" }).click();
    const pre = () => document.querySelector("pre");
    await vi.waitFor(() => expect(pre()?.textContent).toContain("contract DeployERC20"));
    await vi.waitFor(() => expect(pre()?.hasAttribute("data-highlighted")).toBe(true), { timeout: 5000 });
    await shoot("console-script-dark");
  });

  test("Recipe JSON tab, light only", async () => {
    await renderConsole(erc20Project(), { theme: "light" });
    await page.getByRole("tab", { name: "Recipe JSON" }).click();
    const pre = () => document.querySelector("pre");
    await vi.waitFor(() => expect(pre()?.textContent).toContain('"$schema"'));
    await shoot("console-json-light");
  });
});
