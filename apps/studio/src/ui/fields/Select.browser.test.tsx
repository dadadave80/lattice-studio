import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { Select, type SelectOption } from "./Select";

const NETWORKS: SelectOption[] = [
  { value: "anvil", label: "Anvil", description: "Local node on 8545" },
  { value: "sepolia", label: "Sepolia" },
  { value: "base-sepolia", label: "Base Sepolia" },
];

function Network({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <Select
      label="Network"
      placeholder="Choose a network"
      options={NETWORKS}
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

const expanded = () => document.querySelector('[role="combobox"]')?.getAttribute("aria-expanded");
const popup = () => document.querySelector('[role="listbox"]')?.closest("[data-keyctx]");

describe("Select", () => {
  test("its label is its name; the placeholder shows until something is picked", async () => {
    await renderWithStudio(<Network />);
    const trigger = page.getByRole("combobox", { name: "Network" });
    await expect.element(trigger).toHaveTextContent("Choose a network");
  });

  test("keyboard: Enter opens, arrows move, Enter picks, focus returns to the trigger", async () => {
    const onChange = vi.fn();
    await renderWithStudio(<Network onChange={onChange} />);
    const trigger = page.getByRole("combobox", { name: "Network" });
    await userEvent.tab();
    await expect.element(trigger).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(expanded).toBe("true");
    expect(popup()?.getAttribute("data-keyctx")).toBe("list");
    await expect.element(page.getByRole("option", { name: /Anvil/ })).toBeVisible();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(page.getByRole("option", { name: "Sepolia", exact: true })).toHaveAttribute("data-highlighted");
    await userEvent.keyboard("{Enter}");
    await expect.poll(expanded).toBe("false");
    await expect.element(trigger).toHaveTextContent("Sepolia");
    await expect.element(trigger).toHaveFocus();
    expect(onChange.mock.calls).toEqual([["sepolia"]]);
  });

  test("Esc closes without picking and focus returns to the trigger", async () => {
    const onChange = vi.fn();
    await renderWithStudio(<Network onChange={onChange} />);
    const trigger = page.getByRole("combobox", { name: "Network" });
    await trigger.click();
    await expect.poll(expanded).toBe("true");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Escape}");
    await expect.poll(expanded).toBe("false");
    await expect.element(trigger).toHaveFocus();
    await expect.element(trigger).toHaveTextContent("Choose a network");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("a click on an option picks it", async () => {
    const onChange = vi.fn();
    await renderWithStudio(<Network onChange={onChange} />);
    await page.getByRole("combobox", { name: "Network" }).click();
    await page.getByRole("option", { name: "Base Sepolia" }).click();
    expect(onChange.mock.calls).toEqual([["base-sepolia"]]);
  });

  test("its description is wired; a hidden label still names it", async () => {
    await renderWithStudio(
      <>
        <Select label="Network" options={NETWORKS} defaultValue="anvil" description="Where the diamond deploys." />
        <Select label="Unit" hideLabel options={[{ value: "s", label: "s" }]} defaultValue="s" />
      </>,
    );
    await expect
      .element(page.getByRole("combobox", { name: "Network" }))
      .toHaveAccessibleDescription("Where the diamond deploys.");
    await expect.element(page.getByRole("combobox", { name: "Unit" })).toHaveTextContent("s");
    // Visually hidden: a 1 px box, still in the accessibility tree.
    expect(page.getByText("Unit", { exact: true }).element().getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  test("disabled with a reason: focusable, says why, never opens or changes", async () => {
    const onChange = vi.fn();
    await renderWithStudio(
      <Select
        label="Network"
        options={NETWORKS}
        defaultValue="anvil"
        disabledReason="Connect a wallet first"
        onValueChange={onChange}
      />,
    );
    const trigger = page.getByRole("combobox", { name: "Network" });
    await expect.element(trigger).toHaveAttribute("aria-disabled", "true");
    await expect.element(trigger).toHaveAccessibleDescription("Connect a wallet first");
    await userEvent.tab();
    await expect.element(trigger).toHaveFocus();
    for (const key of ["{Enter}", " ", "{ArrowDown}", "{ArrowUp}", "s"]) await userEvent.keyboard(key);
    await trigger.click({ force: true });
    expect(expanded()).toBe("false");
    await expect.element(page.getByRole("option", { name: "Sepolia", exact: true })).not.toBeInTheDocument();
    await expect.element(trigger).toHaveTextContent("Anvil");
    await expect.element(trigger).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("the trigger and each option are at least 24 px tall", async () => {
    await renderWithStudio(<Network />);
    const trigger = page.getByRole("combobox", { name: "Network" });
    expect(trigger.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    await trigger.click();
    const option = page.getByRole("option", { name: "Sepolia", exact: true });
    await expect.element(option).toBeVisible();
    expect(option.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
  });
});
