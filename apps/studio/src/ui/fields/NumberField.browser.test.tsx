import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { NumberField, type NumberFieldProps } from "./NumberField";

const UNITS = [
  { value: "ether", label: "ether" },
  { value: "gwei", label: "gwei" },
  { value: "wei", label: "wei" },
];

type SupplyProps = Partial<Omit<NumberFieldProps, "value" | "onValueChange">> & {
  initial?: string;
  onChange?: (v: string) => void;
};

function Supply({ initial = "0", onChange, ...rest }: SupplyProps) {
  const [value, setValue] = useState(initial);
  const [unit, setUnit] = useState("ether");
  return (
    <NumberField
      label="Initial supply"
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      units={UNITS}
      unit={unit}
      onUnitChange={setUnit}
      {...rest}
    />
  );
}

const input = () => page.getByRole("textbox", { name: "Initial supply" });

describe("NumberField", () => {
  test("a decimal text input, not a spinbutton, named by its label", async () => {
    await renderWithStudio(<Supply />);
    const el = input().element() as HTMLInputElement;
    expect(el.getAttribute("role")).toBeNull();
    expect(el.inputMode).toBe("decimal");
    expect(el.getAttribute("aria-keyshortcuts")).toBe("ArrowUp ArrowDown Shift+ArrowUp Shift+ArrowDown");
    expect(document.querySelector('[role="spinbutton"]')).toBeNull();
  });

  test("↑ and ↓ step by `step`; Shift steps ten times as far; the fraction stays", async () => {
    await renderWithStudio(<Supply initial="1.5" step={2} />);
    await userEvent.tab();
    await expect.element(input()).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(input()).toHaveValue("3.5");
    await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");
    await expect.element(input()).toHaveValue("23.5");
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(input()).toHaveValue("21.5");
  });

  test("clamps to min and max; unsigned stops at 0", async () => {
    await renderWithStudio(
      <>
        <Supply initial="95" max="100" />
      </>,
    );
    await userEvent.tab();
    await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");
    await expect.element(input()).toHaveValue("100");
    await userEvent.keyboard("{Shift>}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{/Shift}");
    await expect.element(input()).toHaveValue("0");
  });

  test("signed fields go below 0 down to min", async () => {
    await renderWithStudio(<Supply initial="1" signed min={-2n} />);
    await userEvent.tab();
    for (let i = 0; i < 5; i++) await userEvent.keyboard("{ArrowDown}");
    await expect.element(input()).toHaveValue("-2");
  });

  test("a value above 2^53 steps exactly", async () => {
    const big = "115792089237316195423570985008687907853269984665640564039457584007913129639934";
    await renderWithStudio(<Supply initial={big} step={1n} />);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowUp}");
    await expect
      .element(input())
      .toHaveValue("115792089237316195423570985008687907853269984665640564039457584007913129639935");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await expect
      .element(input())
      .toHaveValue("115792089237316195423570985008687907853269984665640564039457584007913129639933");
  });

  test("text that isn't a plain decimal is left alone and nothing throws", async () => {
    const onChange = vi.fn();
    await renderWithStudio(<Supply initial="1e18" onChange={onChange} />);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowUp}{ArrowDown}");
    await expect.element(input()).toHaveValue("1e18");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("typing edits the text as is", async () => {
    await renderWithStudio(<Supply initial="" />);
    await input().click();
    await userEvent.keyboard("1000000.25");
    await expect.element(input()).toHaveValue("1000000.25");
  });

  test("the unit select is named after the field and shows the current unit", async () => {
    await renderWithStudio(<Supply />);
    const unit = page.getByRole("combobox", { name: "Initial supply unit" });
    await expect.element(unit).toHaveTextContent("ether");
    await userEvent.tab();
    await userEvent.tab();
    await expect.element(unit).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await page.getByRole("option", { name: "gwei" }).click();
    await expect.element(unit).toHaveTextContent("gwei");
    await expect.element(input()).toBeVisible();
  });

  test("description and error are wired", async () => {
    await renderWithStudio(
      <Supply initial="-1" description="Minted to the deploying account." error="Enter a whole number of 0 or more." />,
    );
    await expect.element(input()).toHaveAttribute("aria-invalid", "true");
    await expect
      .element(input())
      .toHaveAccessibleDescription("Minted to the deploying account. Enter a whole number of 0 or more.");
  });

  test("disabled with a reason: focusable, says why, never steps, the unit never changes", async () => {
    const onChange = vi.fn();
    await renderWithStudio(<Supply initial="5" disabledReason="Connect a wallet first" onChange={onChange} />);
    await expect.element(input()).toHaveAttribute("aria-disabled", "true");
    await expect.element(input()).toHaveAccessibleDescription("Connect a wallet first");
    await userEvent.tab();
    await expect.element(input()).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}{Shift>}{ArrowUp}{/Shift}7");
    await expect.element(input()).toHaveValue("5");
    const unit = page.getByRole("combobox", { name: "Initial supply unit" });
    await expect.element(unit).toHaveAttribute("aria-disabled", "true");
    await userEvent.tab();
    await expect.element(unit).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(unit).toHaveAttribute("aria-expanded", "false");
    await expect.element(unit.getByText("ether", { exact: true })).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("the input and the unit select are at least 24 px tall", async () => {
    await renderWithStudio(<Supply />);
    expect(input().element().getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    const unit = page.getByRole("combobox", { name: "Initial supply unit" }).element().getBoundingClientRect();
    expect(unit.height).toBeGreaterThanOrEqual(24);
    expect(unit.width).toBeGreaterThanOrEqual(24);
  });
});
