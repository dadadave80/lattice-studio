import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { SegmentedToggle } from "./SegmentedToggle";

const THEMES = [
  { value: "shop", label: "Shop" },
  { value: "draft", label: "Draft" },
] as const;

function Theme({ onChange, disabledReason }: { onChange?: (v: string) => void; disabledReason?: string }) {
  const [value, setValue] = useState<"shop" | "draft">("shop");
  return (
    <SegmentedToggle
      label="Theme"
      value={value}
      options={THEMES}
      onValueChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      {...(disabledReason ? { disabledReason } : {})}
    />
  );
}

describe("SegmentedToggle", () => {
  test("names the group; arrows move between options; Space and Enter pick one", async () => {
    const onChange = vi.fn();
    await renderWithStudio(<Theme onChange={onChange} />);
    await expect.element(page.getByRole("group", { name: "Theme" })).toBeVisible();
    const shop = page.getByRole("button", { name: "Shop" });
    const draft = page.getByRole("button", { name: "Draft" });
    await expect.element(shop).toHaveAttribute("aria-pressed", "true");

    await userEvent.tab();
    await expect.element(shop).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(draft).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect.element(draft).toHaveAttribute("aria-pressed", "true");
    await expect.element(shop).toHaveAttribute("aria-pressed", "false");
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(shop).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(shop).toHaveAttribute("aria-pressed", "true");
    expect(onChange.mock.calls).toEqual([["draft"], ["shop"]]);
  });

  test("pressing the pressed option keeps it pressed", async () => {
    const onChange = vi.fn();
    await renderWithStudio(<Theme onChange={onChange} />);
    const shop = page.getByRole("button", { name: "Shop" });
    await shop.click();
    await expect.element(shop).toHaveAttribute("aria-pressed", "true");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("disabled with a reason: options stay focusable, the group says why, nothing changes", async () => {
    const onChange = vi.fn();
    await renderWithStudio(<Theme onChange={onChange} disabledReason="Resolve 2 blockers · F8" />);
    const group = page.getByRole("group", { name: "Theme" });
    await expect.element(group).toHaveAttribute("aria-disabled", "true");
    await expect.element(group).toHaveAccessibleDescription("Resolve 2 blockers · F8");
    const draft = page.getByRole("button", { name: "Draft" });
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(draft).toHaveFocus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Enter}");
    await draft.click({ force: true });
    await expect.element(draft).toHaveAttribute("aria-pressed", "false");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("each option is at least 24 px square", async () => {
    await renderWithStudio(<Theme />);
    const rect = page.getByRole("button", { name: "Draft" }).element().getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(24);
    expect(rect.height).toBeGreaterThanOrEqual(24);
  });
});
