import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command, settings } from "@/contracts";
import { overrideCommands, onCleanup, renderWithStudio } from "../../../test/harness";
import { Menu } from "../overlays/Menu";
import { MenuItem } from "../overlays/MenuItem";
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
    // The reason describes the button; it isn't part of its name.
    await expect.element(button).toHaveAccessibleName("Deploy…");

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

describe("disabled Button as a menu trigger", () => {
  test("a press, Enter, Space or ↓ never opens the menu; the reason shows instead", async () => {
    const onSelect = vi.fn();
    await renderWithStudio(
      <Menu label="Export" trigger={<Button disabledReason="Resolve 2 blockers to export · F8">Export</Button>}>
        <MenuItem label="Foundry script" onSelect={onSelect} />
      </Menu>,
    );
    const trigger = page.getByRole("button", { name: "Export" });
    await expect.element(trigger).toHaveAttribute("aria-disabled", "true");
    await expect.element(trigger).toHaveAccessibleDescription("Resolve 2 blockers to export · F8");
    await trigger.click({ force: true });
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{ArrowUp}");
    await new Promise((r) => setTimeout(r, 150));
    expect(document.querySelector("[role=menu]")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    await expect.poll(() => document.querySelector("[data-tooltip]")?.textContent).toContain("Resolve 2 blockers to export · F8");
  });

  test("without a reason the same trigger opens the menu", async () => {
    await renderWithStudio(
      <Menu label="Export" trigger={<Button>Export</Button>}>
        <MenuItem label="Foundry script" onSelect={() => {}} />
      </Menu>,
    );
    await page.getByRole("button", { name: "Export" }).click();
    await expect.element(page.getByRole("menu", { name: "Export" })).toBeVisible();
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

  test("exposes the command's shortcut as aria-keyshortcuts, per platform and while single keys are on", async () => {
    onCleanup(overridePlatform("mac"));
    overrideCommands([
      command({ id: "deploy.open", title: () => "Deploy…", category: "Deploy", keys: ["Mod+Enter"], enabled: () => ({ ok: true }), run: () => {} }),
      command({ id: "layout.tidy", title: () => "Tidy layout", category: "Sheet", keys: ["t"], enabled: () => ({ ok: true }), run: () => {} }),
    ]);
    await renderWithStudio(
      <>
        <CommandButton command={{ id: "deploy.open" }} variant="primary" />
        <CommandButton command={{ id: "layout.tidy" }} />
      </>,
    );
    await expect.element(page.getByRole("button", { name: "Deploy…" })).toHaveAttribute("aria-keyshortcuts", "Meta+Enter");
    const tidy = page.getByRole("button", { name: "Tidy layout" });
    await expect.element(tidy).toHaveAttribute("aria-keyshortcuts", "T");
    settings.set({ singleKeys: false });
    await expect.poll(() => tidy.element().hasAttribute("aria-keyshortcuts")).toBe(false);
  });
});
