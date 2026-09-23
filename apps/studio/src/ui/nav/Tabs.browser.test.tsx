import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { TabPanel, Tabs, type TabItem } from "./Tabs";

const TABS: TabItem[] = [
  { value: "log", label: "Log", count: 3 },
  { value: "script", label: "Script", disabledReason: "Place facets first" },
  { value: "json", label: "Recipe JSON" },
  { value: "summary", label: "Summary" },
];

function Harness({ onChange, orientation }: { onChange: (value: string) => void; orientation?: "horizontal" | "vertical" }) {
  const [value, setValue] = useState("log");
  return (
    <>
      <button type="button">Before</button>
      <Tabs
        label="Console"
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        tabs={TABS}
        {...(orientation ? { orientation } : {})}
      >
        {TABS.map((tab) => (
          <TabPanel key={tab.value} value={tab.value}>
            {tab.label} panel
          </TabPanel>
        ))}
      </Tabs>
    </>
  );
}

const tab = (name: string | RegExp) => page.getByRole("tab", { name });

describe("Tabs", () => {
  test("the list is one Tab stop, on the open tab", async () => {
    await renderWithStudio(<Harness onChange={vi.fn()} />);
    await page.getByRole("button", { name: "Before" }).click();
    await userEvent.tab();
    await expect.element(tab(/^Log/)).toHaveFocus();
    await expect.element(tab(/^Log/)).toHaveAttribute("aria-selected", "true");
    await userEvent.tab();
    expect(document.activeElement?.getAttribute("role")).not.toBe("tab");
    expect(page.getByRole("tablist", { name: "Console" }).element()).toBeTruthy();
  });

  test("arrows, Home and End move and open, skipping nothing", async () => {
    const onChange = vi.fn();
    await renderWithStudio(<Harness onChange={onChange} />);
    await tab(/^Log/).click();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(tab("Script")).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(tab("Recipe JSON")).toHaveFocus();
    await expect.element(tab("Recipe JSON")).toHaveAttribute("aria-selected", "true");
    await expect.element(page.getByText("Recipe JSON panel")).toBeVisible();
    await userEvent.keyboard("{End}");
    await expect.element(tab("Summary")).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Home}");
    await expect.element(tab(/^Log/)).toHaveFocus();
    await expect.element(tab(/^Log/)).toHaveAttribute("aria-selected", "true");
    expect(onChange.mock.calls.map(([value]) => value)).toEqual(["json", "summary", "log"]);
  });

  test("a vertical list takes ↑ ↓", async () => {
    await renderWithStudio(<Harness onChange={vi.fn()} orientation="vertical" />);
    await tab(/^Log/).click();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await expect.element(tab("Recipe JSON")).toHaveAttribute("aria-selected", "true");
  });

  test("a disabled tab is reachable, says why and never opens", async () => {
    const onChange = vi.fn();
    await renderWithStudio(<Harness onChange={onChange} />);
    await tab(/^Log/).click();
    await userEvent.keyboard("{ArrowRight}");
    const script = tab("Script");
    await expect.element(script).toHaveFocus();
    await expect.element(script).toHaveAttribute("aria-disabled", "true");
    await expect.element(script).toHaveAccessibleDescription("Place facets first");
    await expect.element(script).toHaveAttribute("aria-selected", "false");
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    await script.click({ force: true });
    expect(onChange).not.toHaveBeenCalled();
    await expect.element(tab(/^Log/)).toHaveAttribute("aria-selected", "true");
    await expect.element(page.getByText("Log panel")).toBeVisible();
  });

  test("the count is part of the name; tabs are 40 px, or 28 px compact", async () => {
    await renderWithStudio(
      <>
        <Harness onChange={vi.fn()} />
        <Tabs label="Panes" value="sheet" onValueChange={vi.fn()} size="compact" tabs={[{ value: "sheet", label: "Sheet" }]} />
      </>,
    );
    await expect.element(tab("Log 3")).toBeInTheDocument();
    expect(tab("Summary").element().getBoundingClientRect().height).toBe(40);
    const compact = tab("Sheet").element().getBoundingClientRect();
    expect(compact.height).toBe(28);
    expect(compact.width).toBeGreaterThanOrEqual(24);
  });
});
