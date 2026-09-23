/**
 * The drawer's body is its own chunk (FX17, spec L822). One file with one running order, so the module state
 * (whether the body's chunk has arrived) starts empty.
 */
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { initialSession } from "@/contracts";
import { renderWithStudio } from "../../../test/harness";
import { ConsolePanel } from "./ConsolePanel";
import { consoleBodyLoaded } from "./load-body";
import { awaitConsoleBody, erc20Project, resetConsole } from "./test-support";

describe("the console body's chunk", () => {
  test("a collapsed drawer paints its frame alone; Export's items and opening the drawer bring the body; the frame stays the same", async () => {
    resetConsole();
    const panes = initialSession().panes;
    await renderWithStudio(<div style={{ height: "400px", display: "flex" }}><ConsolePanel /></div>, {
      project: erc20Project(),
      session: { panes: { ...panes, console: { ...panes.console, open: false } } },
    });
    const header = () => document.querySelector("[data-keyctx='console'] > header");
    const expand = page.getByRole("button", { name: "Expand console" });
    const exportMenu = page.getByRole("button", { name: "Export", exact: true });

    // The frame: toggle, summary, tabs, Export, the size menu and Maximize. No body yet.
    await expect.element(expand).toBeVisible();
    await expect.element(exportMenu).toBeVisible();
    await expect.element(page.getByRole("tab", { name: "Recipe JSON" })).toBeVisible();
    const frame = header()?.textContent ?? "";
    expect(frame).toContain("1 warning");
    expect(consoleBodyLoaded()).toBe(false);
    expect(document.querySelector("[role='log']")).toBeNull();

    // The Export menu works with the drawer collapsed: its items arrive with the body's chunk.
    await userEvent.click(exportMenu);
    await expect.element(page.getByRole("menuitem", { name: "Foundry script" }), { timeout: 15_000 }).toBeVisible();
    expect(consoleBodyLoaded()).toBe(true);
    // Items that mounted after the popup opened still take the arrow keys.
    await userEvent.keyboard("{ArrowDown}");
    await vi.waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("menuitem"));
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("menu", { name: "Export" })).not.toBeInTheDocument();

    // Opening the drawer shows the body; the header reads as it did before.
    await userEvent.click(expand);
    await awaitConsoleBody();
    await expect.element(page.getByRole("textbox", { name: "Command line" })).toBeVisible();
    expect(header()?.textContent).toBe(frame);
  });
});
