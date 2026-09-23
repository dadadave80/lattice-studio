import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { Button } from "../buttons/Button";
import { Popover } from "./Popover";

describe("Popover", () => {
  test("opens labelled by its title, moves focus in, and Esc returns focus to the trigger", async () => {
    await renderWithStudio(
      <Popover trigger={<Button>Salt</Button>} title="Salt" description="CREATE2 salt for this deploy." closeButton>
        <Button>Use a new salt</Button>
      </Popover>,
    );
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    const popup = page.getByRole("dialog", { name: "Salt" });
    await expect.element(popup).toBeVisible();
    await expect.element(popup).toHaveAccessibleDescription("CREATE2 salt for this deploy.");
    await expect.element(page.getByRole("button", { name: "Use a new salt" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Salt" })).toHaveFocus();
  });

  test("Close closes it and returns focus", async () => {
    await renderWithStudio(
      <Popover trigger={<Button>Details</Button>} title="Details" closeButton>
        <p>Three facets share this storage slot.</p>
      </Popover>,
    );
    await page.getByRole("button", { name: "Details" }).click();
    await expect.element(page.getByRole("button", { name: "Close" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Details" })).toHaveFocus();
  });

  test("with nothing focusable inside, the popup itself takes focus", async () => {
    await renderWithStudio(
      <Popover trigger={<Button>Details</Button>} title="Details">
        <p>Three facets share this storage slot.</p>
      </Popover>,
    );
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    const popup = page.getByRole("dialog", { name: "Details" });
    await expect.element(popup).toBeVisible();
    await expect.poll(() => popup.element().contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("button", { name: "Details" })).toHaveFocus();
  });
});
