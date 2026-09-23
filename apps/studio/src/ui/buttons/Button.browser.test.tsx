import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command } from "@/contracts";
import { overrideCommands, onCleanup, renderWithStudio } from "../../../test/harness";
import { overridePlatform } from "../shared/platform";
import { Button } from "./Button";
import { CommandButton } from "./CommandButton";
import { IconButton } from "./IconButton";

describe("Button", () => {
  test("activates with click, Enter and Space", async () => {
    const onClick = vi.fn();
    await renderWithStudio(<Button onClick={onClick}>Place EmergencyStop</Button>);
    const button = page.getByRole("button", { name: "Place EmergencyStop" });
    await button.click();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  test("a disabled button stays focusable, says why and never activates", async () => {
    const onClick = vi.fn();
    await renderWithStudio(
      <Button variant="primary" onClick={onClick} disabledReason="Resolve 2 blockers · F8">
        Deploy…
      </Button>,
    );
    const button = page.getByRole("button", { name: "Deploy…" });
    const el = button.element() as HTMLButtonElement;
    expect(el.disabled).toBe(false);
    expect(el.getAttribute("aria-disabled")).toBe("true");
    await expect.element(button).toHaveAccessibleDescription("Resolve 2 blockers · F8");

    await userEvent.tab();
    await expect.element(button).toHaveFocus();
    // Focus shows the reason in a tooltip.
    await expect.element(page.getByText("Resolve 2 blockers · F8", { exact: true }).last()).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    await button.click({ force: true });
    expect(onClick).not.toHaveBeenCalled();
  });

  test("Esc closes the reason tooltip and focus stays", async () => {
    await renderWithStudio(<Button disabledReason="Place facets first">Deploy…</Button>);
    await userEvent.tab();
    const tip = page.getByText("Place facets first", { exact: true }).last();
    await expect.element(tip).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[data-tooltip]")).toBeNull();
    await expect.element(page.getByRole("button", { name: "Deploy…" })).toHaveFocus();
  });
});

describe("IconButton", () => {
  test("its label is its name and tooltip, with the shortcut per platform", async () => {
    onCleanup(overridePlatform("mac"));
    await renderWithStudio(<IconButton icon="undo" label="Undo" shortcut="Mod+z" />);
    const button = page.getByRole("button", { name: "Undo" });
    expect(button.element().getAttribute("aria-keyshortcuts")).toBe("Meta+Z");
    await userEvent.tab();
    await expect.element(page.getByText("⌘Z")).toBeVisible();
  });

  test("shows Ctrl on Windows and Linux", async () => {
    onCleanup(overridePlatform("other"));
    await renderWithStudio(<IconButton icon="undo" label="Undo" shortcut="Mod+z" />);
    expect(page.getByRole("button", { name: "Undo" }).element().getAttribute("aria-keyshortcuts")).toBe("Control+Z");
    await userEvent.tab();
    await expect.element(page.getByText("Ctrl+Z")).toBeVisible();
  });

  test("is at least 24 x 24 px", async () => {
    await renderWithStudio(<IconButton icon="close" label="Close" size="small" />);
    const rect = page.getByRole("button", { name: "Close" }).element().getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(24);
    expect(rect.height).toBeGreaterThanOrEqual(24);
  });
});

describe("CommandButton", () => {
  test("takes the command's title and reason, and runs it", async () => {
    const run = vi.fn();
    overrideCommands([
      command({
        id: "layout.tidy",
        title: () => "Tidy layout",
        category: "Sheet",
        enabled: () => ({ ok: true }),
        run,
      }),
      command({
        id: "deploy.open",
        title: () => "Deploy…",
        category: "Deploy",
        enabled: () => ({ ok: false, reason: "Resolve 2 blockers · F8" }),
        run,
      }),
    ]);
    await renderWithStudio(
      <>
        <CommandButton command={{ id: "layout.tidy" }} />
        <CommandButton command={{ id: "deploy.open" }} variant="primary" />
      </>,
    );
    await page.getByRole("button", { name: "Tidy layout" }).click();
    expect(run).toHaveBeenCalledTimes(1);
    const deploy = page.getByRole("button", { name: "Deploy…" });
    await expect.element(deploy).toHaveAccessibleDescription("Resolve 2 blockers · F8");
    await deploy.click({ force: true });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
