import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { Checkbox } from "./Checkbox";

const ACK = "I understand this deploys unaudited code";

describe("Checkbox", () => {
  test("a long label is its name; Space, a click and a click on the label toggle it", async () => {
    const onCheckedChange = vi.fn();
    await renderWithStudio(<Checkbox label={ACK} onCheckedChange={onCheckedChange} />);
    const box = page.getByRole("checkbox", { name: ACK });
    await expect.element(box).not.toBeChecked();

    await userEvent.tab();
    await expect.element(box).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect.element(box).toBeChecked();
    await box.click();
    await expect.element(box).not.toBeChecked();
    await page.getByText(ACK).click();
    await expect.element(box).toBeChecked();
    expect(onCheckedChange.mock.calls).toEqual([[true], [false], [true]]);
    expect(box.element().querySelector("[data-icon='check']")).not.toBeNull();
  });

  test("its description is wired", async () => {
    await renderWithStudio(<Checkbox label={ACK} description="No audit covers ERC20Pausable at this tag." />);
    await expect
      .element(page.getByRole("checkbox", { name: ACK }))
      .toHaveAccessibleDescription("No audit covers ERC20Pausable at this tag.");
  });

  test("disabled with a reason: focusable, says why, never changes", async () => {
    const onCheckedChange = vi.fn();
    await renderWithStudio(
      <Checkbox label={ACK} disabledReason="Resolve 2 blockers · F8" onCheckedChange={onCheckedChange} />,
    );
    const box = page.getByRole("checkbox", { name: ACK });
    await expect.element(box).toHaveAttribute("aria-disabled", "true");
    await expect.element(box).toHaveAccessibleDescription("Resolve 2 blockers · F8");

    await userEvent.tab();
    await expect.element(box).toHaveFocus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Enter}");
    await box.click({ force: true });
    await page.getByText(ACK).click({ force: true });
    await expect.element(box).not.toBeChecked();
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  test("the whole row is at least 24 px tall and wraps a long label", async () => {
    await renderWithStudio(
      <div style={{ inlineSize: "160px" }}>
        <Checkbox label={ACK} />
      </div>,
    );
    const row = page.getByText(ACK).element().closest("label");
    const rect = row?.getBoundingClientRect();
    expect(rect?.height).toBeGreaterThanOrEqual(40);
    expect(rect?.width).toBeLessThanOrEqual(160);
  });
});
