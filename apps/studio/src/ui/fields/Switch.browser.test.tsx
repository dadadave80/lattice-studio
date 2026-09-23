import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { Switch } from "./Switch";

describe("Switch", () => {
  test("its label is its name; Space, a click and a click on the label toggle it", async () => {
    const onCheckedChange = vi.fn();
    await renderWithStudio(<Switch label="Reduce motion" onCheckedChange={onCheckedChange} />);
    const control = page.getByRole("switch", { name: "Reduce motion" });
    await expect.element(control).toHaveAttribute("aria-checked", "false");

    await userEvent.tab();
    await expect.element(control).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect.element(control).toHaveAttribute("aria-checked", "true");
    await control.click();
    await expect.element(control).toHaveAttribute("aria-checked", "false");
    await page.getByText("Reduce motion").click();
    await expect.element(control).toHaveAttribute("aria-checked", "true");
    expect(onCheckedChange.mock.calls).toEqual([[true], [false], [true]]);
  });

  test("its description is wired", async () => {
    await renderWithStudio(
      <Switch label="Announce deploy output" description="Errors are always announced." defaultChecked />,
    );
    const control = page.getByRole("switch", { name: "Announce deploy output" });
    await expect.element(control).toBeChecked();
    await expect.element(control).toHaveAccessibleDescription("Errors are always announced.");
  });

  test("disabled with a reason: focusable, says why, never changes", async () => {
    const onCheckedChange = vi.fn();
    await renderWithStudio(
      <Switch
        label="Use the connected wallet"
        description="Signs with the account in your wallet."
        disabledReason="Connect a wallet first"
        onCheckedChange={onCheckedChange}
      />,
    );
    const control = page.getByRole("switch", { name: "Use the connected wallet" });
    await expect.element(control).toHaveAttribute("aria-disabled", "true");
    await expect
      .element(control)
      .toHaveAccessibleDescription("Signs with the account in your wallet. Connect a wallet first");

    await userEvent.tab();
    await expect.element(control).toHaveFocus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Enter}");
    await control.click({ force: true });
    await page.getByText("Use the connected wallet").click({ force: true });
    await expect.element(control).toHaveAttribute("aria-checked", "false");
    expect(onCheckedChange).not.toHaveBeenCalled();
    await expect.element(page.getByText("Connect a wallet first", { exact: true }).last()).toBeVisible();
  });

  test("the whole row is at least 24 px tall", async () => {
    await renderWithStudio(<Switch label="Reduce motion" />);
    const row = page.getByText("Reduce motion").element().closest("label");
    const rect = row?.getBoundingClientRect();
    expect(rect?.height).toBeGreaterThanOrEqual(24);
    expect(rect?.width).toBeGreaterThanOrEqual(24);
  });
});
