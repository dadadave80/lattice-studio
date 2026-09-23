import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { settings } from "@/contracts";
import { onCleanup, renderWithStudio } from "../../../test/harness";
import { overridePlatform } from "../shared/platform";
import { ToggleButton } from "./ToggleButton";

describe("ToggleButton", () => {
  test("Space, Enter and a click toggle aria-pressed", async () => {
    const onPressedChange = vi.fn();
    await renderWithStudio(<ToggleButton onPressedChange={onPressedChange}>Minimap</ToggleButton>);
    const toggle = page.getByRole("button", { name: "Minimap" });
    await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.tab();
    await expect.element(toggle).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{Enter}");
    await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
    expect(onPressedChange.mock.calls).toEqual([[true], [false], [true]]);
  });

  test("icon only: the label is its name and tooltip, with the shortcut", async () => {
    onCleanup(overridePlatform("mac"));
    await renderWithStudio(<ToggleButton icon="minimap" label="Show minimap" shortcut="Mod+m" defaultPressed />);
    const toggle = page.getByRole("button", { name: "Show minimap" });
    await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle.element().getAttribute("aria-keyshortcuts")).toBe("Meta+M");
    await userEvent.tab();
    await expect.element(page.getByText("Show minimap", { exact: true }).last()).toBeVisible();
  });

  test("a single-key shortcut is announced only while single-key shortcuts are on", async () => {
    await renderWithStudio(<ToggleButton icon="minimap" label="Show minimap" shortcut="t" />);
    const toggle = page.getByRole("button", { name: "Show minimap" });
    await expect.element(toggle).toHaveAttribute("aria-keyshortcuts", "T");
    settings.set({ singleKeys: false });
    await expect.element(toggle).not.toHaveAttribute("aria-keyshortcuts");
  });

  test("disabled with a reason: focusable, says why, never changes", async () => {
    const onPressedChange = vi.fn();
    await renderWithStudio(
      <ToggleButton disabledReason="Connect a wallet first" onPressedChange={onPressedChange}>
        Watch balances
      </ToggleButton>,
    );
    const toggle = page.getByRole("button", { name: "Watch balances" });
    await expect.element(toggle).toHaveAttribute("aria-disabled", "true");
    await expect.element(toggle).toHaveAccessibleDescription("Connect a wallet first");
    await userEvent.tab();
    await expect.element(toggle).toHaveFocus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Enter}");
    await toggle.click({ force: true });
    await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
    expect(onPressedChange).not.toHaveBeenCalled();
  });

  test("is at least 24 x 24 px, icon only and small", async () => {
    await renderWithStudio(<ToggleButton icon="minimap" label="Show minimap" size="small" />);
    const rect = page.getByRole("button", { name: "Show minimap" }).element().getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(24);
    expect(rect.height).toBeGreaterThanOrEqual(24);
  });
});
