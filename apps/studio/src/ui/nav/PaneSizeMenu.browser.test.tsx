import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { PaneSizeMenu } from "./PaneSizeMenu";

function Harness({ start, onCollapse, pane = "Catalog", dimension }: {
  start: number; onCollapse: () => void; pane?: string; dimension?: "width" | "height";
}) {
  const [size, setSize] = useState(start);
  return (
    <div>
      <PaneSizeMenu
        pane={pane}
        value={size}
        min={200}
        max={360}
        onChange={setSize}
        onCollapse={onCollapse}
        {...(dimension ? { dimension } : {})}
      />
      <output>{`${size}`}</output>
    </div>
  );
}

describe("PaneSizeMenu", () => {
  test("Narrower, Wider and Collapse from the keyboard", async () => {
    const onCollapse = vi.fn();
    await renderWithStudio(<Harness start={240} onCollapse={onCollapse} />);
    await userEvent.tab();
    await expect.element(page.getByRole("button", { name: "Catalog menu" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("menuitem", { name: "Narrower" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("232", { exact: true })).toBeVisible();
    await userEvent.keyboard("{ArrowDown}{Enter}{Enter}");
    await expect.element(page.getByText("248", { exact: true })).toBeVisible();
    await userEvent.keyboard("{End}{Enter}");
    expect(onCollapse).toHaveBeenCalledTimes(1);
    await expect.poll(() => document.querySelector("[role=menu]")).toBeNull();
    await expect.element(page.getByRole("button", { name: "Catalog menu" })).toHaveFocus();
  });

  test("at a limit the step says why not and what to do, keeping the pane's name", async () => {
    await renderWithStudio(<Harness start={200} onCollapse={() => {}} />);
    await page.getByRole("button", { name: "Catalog menu" }).click();
    const narrower = page.getByRole("menuitem", { name: "Narrower" });
    await expect.element(narrower).toHaveAttribute("aria-disabled", "true");
    await expect.element(narrower).toHaveAccessibleDescription("Catalog is at its narrowest; choose Wider or Collapse");
    await narrower.click({ force: true });
    await expect.element(page.getByText("200", { exact: true })).toBeVisible();
  });

  test("the console drawer uses vertical words", async () => {
    await renderWithStudio(<Harness start={360} onCollapse={() => {}} pane="Console" dimension="height" />);
    await page.getByRole("button", { name: "Console menu" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Shorter" })).toBeVisible();
    await expect
      .element(page.getByRole("menuitem", { name: "Taller" }))
      .toHaveAccessibleDescription("Console is at its tallest; choose Shorter or Collapse");
  });
});
