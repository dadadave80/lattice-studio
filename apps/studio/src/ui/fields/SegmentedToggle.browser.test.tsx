import { useEffect, useState } from "react";
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

  test("disabled with a reason: options stay focusable, each option says why, nothing changes", async () => {
    const onChange = vi.fn();
    await renderWithStudio(<Theme onChange={onChange} disabledReason="Resolve 2 blockers · F8" />);
    const group = page.getByRole("group", { name: "Theme" });
    await expect.element(group).toHaveAttribute("aria-disabled", "true");
    await expect.element(group).toHaveAccessibleDescription("");
    const shop = page.getByRole("button", { name: "Shop" });
    const draft = page.getByRole("button", { name: "Draft" });
    for (const option of [shop, draft]) {
      await expect.element(option).toHaveAttribute("aria-disabled", "true");
      await expect.element(option).toHaveAccessibleDescription("Resolve 2 blockers · F8");
    }
    // Every option is aria-disabled, so the tab stop stays on the pressed one and arrows have nowhere to go.
    await userEvent.tab();
    await expect.element(shop).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(shop).toHaveFocus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Enter}");
    await expect.element(shop).toHaveAttribute("aria-pressed", "true");
    await draft.click({ force: true });
    await expect.element(draft).toHaveAttribute("aria-pressed", "false");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("the reason is written once and read once: every option points at it, the group doesn't", async () => {
    await renderWithStudio(<Theme disabledReason="Resolve 2 blockers · F8" />);
    const group = page.getByRole("group", { name: "Theme" }).element();
    const holders = [...document.querySelectorAll<HTMLElement>("[hidden]")].filter(
      (el) => el.textContent === "Resolve 2 blockers · F8",
    );
    expect(holders).toHaveLength(1);
    const reasonId = holders[0]?.id;
    expect(reasonId).toBeTruthy();
    expect(group.hasAttribute("aria-describedby")).toBe(false);
    for (const name of ["Shop", "Draft"]) {
      expect(page.getByRole("button", { name }).element().getAttribute("aria-describedby")).toBe(reasonId);
    }
  });

  test("disabled: hovering the group or focusing an option shows the reason", async () => {
    await renderWithStudio(
      <>
        <button type="button">Before</button>
        <Theme disabledReason="Resolve 2 blockers · F8" />
      </>,
    );
    const tooltip = () => document.querySelector<HTMLElement>("[data-tooltip]")?.textContent;
    await page.getByRole("button", { name: "Draft" }).hover();
    await expect.poll(tooltip).toBe("Resolve 2 blockers · F8");
    await page.getByRole("button", { name: "Before" }).hover();
    await expect.poll(tooltip).toBeUndefined();
    await page.getByRole("button", { name: "Before" }).click();
    await userEvent.tab();
    await expect.element(page.getByRole("button", { name: "Shop" })).toHaveFocus();
    await expect.poll(tooltip).toBe("Resolve 2 blockers · F8");
  });

  test("a reason coming or going keeps the focused option (no remount); a refused click shows the reason", async () => {
    const control = { set: (_reason: string | undefined) => {} };
    function Toggled() {
      const [reason, setReason] = useState<string | undefined>(undefined);
      useEffect(() => {
        control.set = setReason;
      }, []);
      return <Theme {...(reason ? { disabledReason: reason } : {})} />;
    }
    await renderWithStudio(<Toggled />);
    const shop = page.getByRole("button", { name: "Shop" });
    await userEvent.tab();
    await expect.element(shop).toHaveFocus();
    const before = shop.element();
    control.set("Resolve 2 blockers · F8");
    await expect.element(shop).toHaveAttribute("aria-disabled", "true");
    expect(shop.element()).toBe(before);
    await expect.element(shop).toHaveFocus();
    await page.getByRole("button", { name: "Draft" }).click({ force: true });
    await expect.poll(() => document.querySelector("[data-tooltip]")?.textContent).toBe("Resolve 2 blockers · F8");
    control.set(undefined);
    await expect.element(shop).not.toHaveAttribute("aria-disabled", "true");
    await expect.poll(() => document.querySelector("[data-tooltip]")).toBeNull();
    expect(shop.element()).toBe(before);
  });

  test("each option is at least 24 px square", async () => {
    await renderWithStudio(<Theme />);
    const rect = page.getByRole("button", { name: "Draft" }).element().getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(24);
    expect(rect.height).toBeGreaterThanOrEqual(24);
  });
});
