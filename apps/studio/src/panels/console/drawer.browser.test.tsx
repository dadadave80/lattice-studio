import { beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { runCommand, session } from "@/contracts";
import { bufferedServices, renderWithStudio } from "../../../test/harness";
import { ConsolePanel } from "./ConsolePanel";
import { CONSOLE_SIZES } from "./drawer";
import { erc20Project, resetConsole } from "./test-support";

beforeEach(() => resetConsole());

async function renderConsole() {
  await renderWithStudio(<div style={{ height: "400px", display: "flex" }}><ConsolePanel /></div>, { project: erc20Project() });
}

describe("console header (IR L132, L252)", () => {
  test("Collapse and Expand hide the body and say so; the key context is console", async () => {
    await renderConsole();
    const toggle = page.getByRole("button", { name: "Collapse console" });
    expect(toggle.element().getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("[data-keyctx='console']")).not.toBeNull();
    expect(page.getByRole("textbox", { name: "Command" }).element().getAttribute("data-keyctx")).toBe("text");
    await userEvent.click(toggle);
    expect(session.get().panes.console.open).toBe(false);
    const expand = page.getByRole("button", { name: "Expand console" });
    await expect.element(expand).toHaveAttribute("aria-expanded", "false");
    const body = document.getElementById(expand.element().getAttribute("aria-controls") ?? "");
    expect(body?.hidden).toBe(true);
    expect(bufferedServices().announce.at(-1)?.[0]).toBe("Console collapsed.");
    // A tab opens the drawer again.
    await userEvent.click(page.getByRole("tab", { name: "Recipe JSON" }));
    expect(session.get().panes.console).toMatchObject({ open: true, tab: "recipe" });
  });

  test("Maximize and Restore", async () => {
    await renderConsole();
    await userEvent.click(page.getByRole("button", { name: "Maximize console" }));
    expect(session.get().panes.console.maximized).toBe(true);
    await userEvent.click(page.getByRole("button", { name: "Restore console" }));
    expect(session.get().panes.console.maximized).toBe(false);
    await runCommand({ id: "console.maximize" }, "palette");
    expect(bufferedServices().announce.at(-1)?.[0]).toBe("Console maximized.");
  });

  test("the Console menu makes the drawer shorter or taller by a grid step, and collapses it", async () => {
    await renderConsole();
    await userEvent.click(page.getByRole("button", { name: "Console menu" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Taller" }));
    await vi.waitFor(() => expect(session.get().panes.console.size).toBe(CONSOLE_SIZES.initial + 8));
    await userEvent.click(page.getByRole("menuitem", { name: "Shorter" }));
    await vi.waitFor(() => expect(session.get().panes.console.size).toBe(CONSOLE_SIZES.initial));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(page.getByRole("button", { name: "Console menu" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Collapse" }));
    expect(session.get().panes.console.open).toBe(false);
  });

  test("tabs follow the arrows (APG tabs)", async () => {
    await renderConsole();
    await userEvent.click(page.getByRole("tab", { name: "Log" }));
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(page.getByRole("tab", { name: "Script" })).toHaveAttribute("aria-selected", "true");
    expect(session.get().panes.console.tab).toBe("script");
    await userEvent.keyboard("{ArrowRight}");
    expect(session.get().panes.console.tab).toBe("recipe");
  });
});
