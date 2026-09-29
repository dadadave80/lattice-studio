import { useEffect, useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { emulateForcedColors } from "../testing/axe";
import { SegmentedToggle } from "./SegmentedToggle";

const THEMES = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
] as const;

function Theme({ onChange, disabledReason }: { onChange?: (v: string) => void; disabledReason?: string }) {
  const [value, setValue] = useState<"dark" | "light">("dark");
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
    const dark = page.getByRole("button", { name: "Dark" });
    const light = page.getByRole("button", { name: "Light" });
    await expect.element(dark).toHaveAttribute("aria-pressed", "true");

    await userEvent.tab();
    await expect.element(dark).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(light).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect.element(light).toHaveAttribute("aria-pressed", "true");
    await expect.element(dark).toHaveAttribute("aria-pressed", "false");
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(dark).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(dark).toHaveAttribute("aria-pressed", "true");
    expect(onChange.mock.calls).toEqual([["light"], ["dark"]]);
  });

  test("pressing the pressed option keeps it pressed", async () => {
    const onChange = vi.fn();
    await renderWithStudio(<Theme onChange={onChange} />);
    const dark = page.getByRole("button", { name: "Dark" });
    await dark.click();
    await expect.element(dark).toHaveAttribute("aria-pressed", "true");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("disabled with a reason: options stay focusable, each option says why, nothing changes", async () => {
    const onChange = vi.fn();
    await renderWithStudio(<Theme onChange={onChange} disabledReason="Resolve 2 blockers · F8" />);
    const group = page.getByRole("group", { name: "Theme" });
    await expect.element(group).toHaveAttribute("aria-disabled", "true");
    await expect.element(group).toHaveAccessibleDescription("");
    const dark = page.getByRole("button", { name: "Dark" });
    const light = page.getByRole("button", { name: "Light" });
    for (const option of [dark, light]) {
      await expect.element(option).toHaveAttribute("aria-disabled", "true");
      await expect.element(option).toHaveAccessibleDescription("Resolve 2 blockers · F8");
    }
    // Every option is aria-disabled, so the tab stop stays on the pressed one and arrows have nowhere to go.
    await userEvent.tab();
    await expect.element(dark).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(dark).toHaveFocus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Enter}");
    await expect.element(dark).toHaveAttribute("aria-pressed", "true");
    await light.click({ force: true });
    await expect.element(light).toHaveAttribute("aria-pressed", "false");
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
    for (const name of ["Dark", "Light"]) {
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
    await page.getByRole("button", { name: "Light" }).hover();
    await expect.poll(tooltip).toBe("Resolve 2 blockers · F8");
    await page.getByRole("button", { name: "Before" }).hover();
    await expect.poll(tooltip).toBeUndefined();
    await page.getByRole("button", { name: "Before" }).click();
    await userEvent.tab();
    await expect.element(page.getByRole("button", { name: "Dark" })).toHaveFocus();
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
    const dark = page.getByRole("button", { name: "Dark" });
    await userEvent.tab();
    await expect.element(dark).toHaveFocus();
    const before = dark.element();
    control.set("Resolve 2 blockers · F8");
    await expect.element(dark).toHaveAttribute("aria-disabled", "true");
    expect(dark.element()).toBe(before);
    await expect.element(dark).toHaveFocus();
    await page.getByRole("button", { name: "Light" }).click({ force: true });
    await expect.poll(() => document.querySelector("[data-tooltip]")?.textContent).toBe("Resolve 2 blockers · F8");
    control.set(undefined);
    await expect.element(dark).not.toHaveAttribute("aria-disabled", "true");
    await expect.poll(() => document.querySelector("[data-tooltip]")).toBeNull();
    expect(dark.element()).toBe(before);
  });

  afterEach(async () => {
    await emulateForcedColors(false);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`a disabled pressed segment keeps its accent bar a thin line, not a fill, in ${theme}`, async () => {
      // Button.tsx defines the same `.button[aria-disabled="true"]` class Toggle.module.css's `.segment`
      // composes from. Whichever of the two stylesheets a page loads second wins ties in the cascade; importing
      // Button here reproduces a page that also renders a plain Button, so the reset has to win regardless.
      await import("../buttons/Button");
      await renderWithStudio(
        <SegmentedToggle label="Theme" value="light" options={THEMES} onValueChange={() => {}} disabledReason="Resolve 2 blockers · F8" />,
        { theme },
      );
      const cs = getComputedStyle(page.getByRole("button", { name: "Light" }).element());
      expect(cs.backgroundSize).toBe("100% 2px");
      expect(cs.backgroundRepeat).toBe("no-repeat");
      expect(cs.backgroundPosition).toBe("50% 100%");
    });
  }

  test("in forced colors, a disabled pressed segment uses the system palette, underlined", async () => {
    await renderWithStudio(
      <SegmentedToggle label="Theme" value="light" options={THEMES} onValueChange={() => {}} disabledReason="Resolve 2 blockers · F8" />,
    );
    await emulateForcedColors(true);
    expect(matchMedia("(forced-colors: active)").matches).toBe(true);
    const cs = getComputedStyle(page.getByRole("button", { name: "Light" }).element());
    expect(cs.backgroundImage).toBe("none");
    expect(cs.textDecorationLine).toContain("underline");
  });

  test("each option is at least 24 px square", async () => {
    await renderWithStudio(<Theme />);
    const rect = page.getByRole("button", { name: "Light" }).element().getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(24);
    expect(rect.height).toBeGreaterThanOrEqual(24);
  });
});
