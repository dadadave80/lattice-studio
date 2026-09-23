import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { PaneSizeMenu } from "./PaneSizeMenu";

function Harness({ start, onCollapse }: { start: number; onCollapse: () => void }) {
  const [width, setWidth] = useState(start);
  return (
    <div>
      <PaneSizeMenu pane="Left pane" value={width} min={200} max={360} onChange={setWidth} onCollapse={onCollapse} />
      <output>{`${width}`}</output>
    </div>
  );
}

describe("PaneSizeMenu", () => {
  test("Narrower, Wider and Collapse from the keyboard", async () => {
    const onCollapse = vi.fn();
    await renderWithStudio(<Harness start={240} onCollapse={onCollapse} />);
    await userEvent.tab();
    await expect.element(page.getByRole("button", { name: "Left pane menu" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("menuitem", { name: "Narrower" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("232", { exact: true })).toBeVisible();
    await userEvent.keyboard("{ArrowDown}{Enter}{Enter}");
    await expect.element(page.getByText("248", { exact: true })).toBeVisible();
    await userEvent.keyboard("{End}{Enter}");
    expect(onCollapse).toHaveBeenCalledTimes(1);
    await expect.poll(() => document.querySelector("[role=menu]")).toBeNull();
    await expect.element(page.getByRole("button", { name: "Left pane menu" })).toHaveFocus();
  });

  test("at a limit the step says why it can't", async () => {
    await renderWithStudio(<Harness start={200} onCollapse={() => {}} />);
    await page.getByRole("button", { name: "Left pane menu" }).click();
    const narrower = page.getByRole("menuitem", { name: "Narrower" });
    await expect.element(narrower).toHaveAttribute("aria-disabled", "true");
    await expect.element(narrower).toHaveAccessibleDescription("The left pane is at its narrowest.");
    await narrower.click({ force: true });
    await expect.element(page.getByText("200", { exact: true })).toBeVisible();
  });
});
