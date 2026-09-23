import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { Button } from "../buttons/Button";
import { ReasonTooltip } from "./ReasonTooltip";
import { Tooltip } from "./Tooltip";

const tooltip = () => document.querySelector<HTMLElement>("[data-tooltip]");

describe("Tooltip (WCAG 1.4.13)", () => {
  test("appears on hover and stays while the pointer is over it", async () => {
    await renderWithStudio(
      <Tooltip content="Served by GovernedVault. Click to route here instead." delay={0}>
        <Button>transfer</Button>
      </Tooltip>,
    );
    await page.getByRole("button", { name: "transfer" }).hover();
    await expect.poll(tooltip).not.toBeNull();
    await page.getByText("Served by GovernedVault. Click to route here instead.").hover();
    await new Promise((r) => setTimeout(r, 300));
    expect(tooltip()).not.toBeNull();
  });

  test("appears on keyboard focus and closes with Esc, keeping focus", async () => {
    await renderWithStudio(
      <Tooltip content="Tidy layout" shortcut="t">
        <Button>Tidy</Button>
      </Tooltip>,
    );
    await userEvent.tab();
    await expect.poll(tooltip).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.poll(tooltip).toBeNull();
    await expect.element(page.getByRole("button", { name: "Tidy" })).toHaveFocus();
  });
});

describe("ReasonTooltip", () => {
  test("works on any control: aria-disabled, described by the reason, activation blocked", async () => {
    const onClick = vi.fn();
    await renderWithStudio(
      <ReasonTooltip reason="Connect a wallet to see the deploy address">
        <button type="button" onClick={onClick}>
          Use a new salt
        </button>
      </ReasonTooltip>,
    );
    const button = page.getByRole("button", { name: "Use a new salt" });
    await expect.element(button).toHaveAttribute("aria-disabled", "true");
    await expect.element(button).toHaveAccessibleDescription("Connect a wallet to see the deploy address");
    // Playwright treats aria-disabled as not enabled; a person can still click it.
    await button.click({ force: true });
    await expect.element(button).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onClick).not.toHaveBeenCalled();
    // A click or tap shows the reason too (touch has no hover).
    await expect.poll(tooltip).not.toBeNull();
    expect(tooltip()?.textContent).toContain("Connect a wallet to see the deploy address");
  });

  test("without a reason the control is untouched", async () => {
    const onClick = vi.fn();
    await renderWithStudio(
      <ReasonTooltip reason={null}>
        <button type="button" onClick={onClick}>
          Use a new salt
        </button>
      </ReasonTooltip>,
    );
    const button = page.getByRole("button", { name: "Use a new salt" });
    expect(button.element().hasAttribute("aria-disabled")).toBe(false);
    await button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
