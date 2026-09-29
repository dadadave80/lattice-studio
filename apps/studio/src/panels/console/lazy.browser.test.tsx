/**
 * Shiki and the exporters load only when used (spec L822). One file with one running order, so the module state
 * (what has loaded) starts empty.
 */
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { runCommand } from "@/contracts";
import { onCleanup, renderWithStudio } from "../../../test/harness";
import { ConsolePanel } from "./ConsolePanel";
import { loadedExporters } from "./exporters";
import { highlighterLoaded, highlighterRequested, overrideShikiImport } from "./highlight";
import { awaitConsoleBody, captureDownloads, erc20Project, resetConsole } from "./test-support";

describe("lazy chunks", () => {
  test("nothing heavy loads with the console; each piece loads on first use", async () => {
    resetConsole();
    const files = captureDownloads();
    // Hold Shiki's chunk so the plain text shows first.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    onCleanup(overrideShikiImport(async () => {
      await held;
      return import("./shiki");
    }));

    await renderWithStudio(<div style={{ height: "500px", display: "flex" }}><ConsolePanel /></div>, { project: erc20Project() });
    await awaitConsoleBody();
    await expect.element(page.getByRole("log", { name: "Log" })).toBeVisible();
    expect(loadedExporters()).toEqual([]);
    expect(highlighterRequested()).toBe(false);

    // Hovering the Script tab warms Shiki; opening it loads the Foundry exporter.
    await userEvent.hover(page.getByRole("tab", { name: "Script" }));
    await vi.waitFor(() => expect(highlighterRequested()).toBe(true));
    expect(highlighterLoaded()).toBe(false);
    await userEvent.click(page.getByRole("tab", { name: "Script" }));
    await expect.element(page.getByText("DeployERC20.s.sol")).toBeVisible();
    expect(loadedExporters()).toEqual(["foundry"]);

    // Plain text first; the tokens arrive when Shiki does.
    const pre = () => document.querySelector("pre");
    await vi.waitFor(() => expect(pre()?.textContent).toContain("contract DeployERC20 is Script"));
    expect(pre()?.hasAttribute("data-highlighted")).toBe(false);
    release();
    await vi.waitFor(() => expect(pre()?.hasAttribute("data-highlighted")).toBe(true), { timeout: 5000 });
    expect(highlighterLoaded()).toBe(true);
    // Tokens are React elements whose colors are the themes' custom properties, not Shiki's inline HTML.
    const token = pre()?.querySelector<HTMLElement>("span[style]");
    expect(token?.style.getPropertyValue("--shiki-dark")).toMatch(/^#/);
    expect(token?.style.getPropertyValue("--shiki-light")).toMatch(/^#/);
    expect(getComputedStyle(token as HTMLElement).color).not.toBe("");

    // The exporters are one chunk (FX17): the recipe's is asked for with its tab; the brief and the Safe batch only
    // when asked for.
    await userEvent.click(page.getByRole("tab", { name: "Recipe JSON" }));
    await vi.waitFor(() => expect(pre()?.textContent).toContain('"$schema"'));
    expect(loadedExporters()).toEqual(["foundry", "recipe"]);
    await runCommand({ id: "export.brief" }, "palette");
    await vi.waitFor(() => expect(files).toHaveLength(1));
    expect(loadedExporters()).toEqual(["foundry", "recipe", "brief"]);
    expect(loadedExporters()).not.toContain("safe");
  });
});
