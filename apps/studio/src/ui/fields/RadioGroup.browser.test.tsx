import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { RadioGroup, type RadioOption } from "./RadioGroup";

const OPTIONS: RadioOption[] = [
  { value: "wallet", label: "Connected wallet", description: "Signs each transaction in your wallet." },
  { value: "safe", label: "Safe batch" },
  { value: "foundry", label: "Foundry script" },
];

describe("RadioGroup", () => {
  test("the legend names the group; each label names its radio; descriptions are wired", async () => {
    await renderWithStudio(<RadioGroup label="Deploy with" options={OPTIONS} defaultValue="wallet" />);
    await expect.element(page.getByRole("radiogroup", { name: "Deploy with" })).toBeVisible();
    const wallet = page.getByRole("radio", { name: "Connected wallet" });
    await expect.element(wallet).toBeChecked();
    await expect.element(wallet).toHaveAccessibleDescription("Signs each transaction in your wallet.");
  });

  test("arrow keys move and select; a click on a label selects", async () => {
    const onValueChange = vi.fn();
    await renderWithStudio(
      <RadioGroup label="Deploy with" options={OPTIONS} defaultValue="wallet" onValueChange={onValueChange} />,
    );
    await userEvent.tab();
    const wallet = page.getByRole("radio", { name: "Connected wallet" });
    const safe = page.getByRole("radio", { name: "Safe batch" });
    const foundry = page.getByRole("radio", { name: "Foundry script" });
    await expect.element(wallet).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(safe).toHaveFocus();
    await expect.element(safe).toBeChecked();
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(wallet).toBeChecked();
    await page.getByText("Foundry script").click();
    await expect.element(foundry).toBeChecked();
    expect(onValueChange.mock.calls).toEqual([["safe"], ["wallet"], ["foundry"]]);
  });

  test("an option disabled with a reason says why, is skipped by arrows (APG) and is never selected", async () => {
    const onValueChange = vi.fn();
    const options: RadioOption[] = [
      { value: "wallet", label: "Connected wallet", disabledReason: "Connect a wallet first" },
      { value: "safe", label: "Safe batch" },
      { value: "foundry", label: "Foundry script" },
    ];
    await renderWithStudio(
      <RadioGroup label="Deploy with" options={options} defaultValue="foundry" onValueChange={onValueChange} />,
    );
    const wallet = page.getByRole("radio", { name: "Connected wallet" });
    const safe = page.getByRole("radio", { name: "Safe batch" });
    const foundry = page.getByRole("radio", { name: "Foundry script" });
    await expect.element(wallet).toHaveAttribute("aria-disabled", "true");
    await expect.element(wallet).toHaveAccessibleDescription("Connect a wallet first");
    // Written out under the option too, since arrow keys never land on it.
    await expect.element(page.getByText("Connect a wallet first", { exact: true }).first()).toBeVisible();

    await userEvent.tab();
    await expect.element(foundry).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(safe).toHaveFocus();
    await expect.element(safe).toBeChecked();
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(foundry).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(safe).toHaveFocus();

    await wallet.click({ force: true });
    await page.getByText("Connected wallet").click({ force: true });
    await expect.element(wallet).not.toBeChecked();
    await expect.element(safe).toBeChecked();
    expect(onValueChange.mock.calls).toEqual([["safe"], ["foundry"], ["safe"]]);
  });

  test("each option row is at least 24 px tall", async () => {
    await renderWithStudio(<RadioGroup label="Deploy with" options={OPTIONS} />);
    const rect = page.getByText("Safe batch").element().closest("label")?.getBoundingClientRect();
    expect(rect?.height).toBeGreaterThanOrEqual(24);
  });
});
