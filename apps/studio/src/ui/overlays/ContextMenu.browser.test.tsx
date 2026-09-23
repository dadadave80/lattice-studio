import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { ContextMenu } from "./ContextMenu";
import { MenuItem } from "./MenuItem";
import { MenuSeparator } from "./MenuSeparator";

function Card({ onLocate = () => {}, onCardKey = () => {} }: { onLocate?: () => void; onCardKey?: (key: string) => void }) {
  return (
    <div style={{ padding: 40 }}>
      <ContextMenu
        label="ERC20 actions"
        items={
          <>
            <MenuItem label="Open in inspector" onSelect={() => {}} />
            <MenuItem label="Locate" onSelect={onLocate} />
            <MenuSeparator />
            <MenuItem label="Remove" onSelect={() => {}} shortcut="Delete" />
          </>
        }
      >
        {/* A facet card is a focusable group with its own keys (spec L745). */}
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */}
        <div role="group" aria-label="ERC20, 9 selectors" tabIndex={0} style={{ inlineSize: 200, blockSize: 120 }} onKeyDown={(event) => onCardKey(event.key)}>
          ERC20
        </div>
      </ContextMenu>
    </div>
  );
}

const card = () => page.getByRole("group", { name: "ERC20, 9 selectors" });
const menu = () => page.getByRole("menu", { name: "ERC20 actions" });

describe("ContextMenu", () => {
  test("a right click opens it at the pointer", async () => {
    await renderWithStudio(<Card />);
    const rect = card().element().getBoundingClientRect();
    await card().click({ button: "right", position: { x: 150, y: 90 } });
    await expect.element(menu()).toBeVisible();
    expect(menu().element().getAttribute("data-keyctx")).toBe("menu");
    const popup = menu().element().getBoundingClientRect();
    expect(Math.abs(popup.left - (rect.left + 150))).toBeLessThanOrEqual(8);
    expect(Math.abs(popup.top - (rect.top + 90))).toBeLessThanOrEqual(8);
  });

  test("Shift+F10 on the focused target opens it below the target with focus on the first item", async () => {
    await renderWithStudio(<Card />);
    const cardRect = card().element().getBoundingClientRect();
    await userEvent.tab();
    await expect.element(card()).toHaveFocus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await expect.element(menu()).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Open in inspector" })).toHaveFocus();
    const target = cardRect;
    const popup = menu().element().getBoundingClientRect();
    expect(Math.abs(popup.left - target.left)).toBeLessThanOrEqual(8);
    expect(popup.top).toBeGreaterThanOrEqual(target.bottom);
  });

  test("the Menu key opens it too, arrows move and Enter selects", async () => {
    const onLocate = vi.fn();
    await renderWithStudio(<Card onLocate={onLocate} />);
    await userEvent.tab();
    await userEvent.keyboard("{ContextMenu}");
    await expect.element(page.getByRole("menuitem", { name: "Open in inspector" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(page.getByRole("menuitem", { name: "Locate" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onLocate).toHaveBeenCalledTimes(1);
    await expect.element(menu()).not.toBeInTheDocument();
    await expect.element(card()).toHaveFocus();
  });

  test("Esc closes it and returns focus to the target", async () => {
    await renderWithStudio(<Card />);
    await userEvent.tab();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await expect.element(menu()).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(menu()).not.toBeInTheDocument();
    await expect.element(card()).toHaveFocus();
  });

  test("the target keeps its own key handling", async () => {
    const onCardKey = vi.fn();
    await renderWithStudio(<Card onCardKey={onCardKey} />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("m");
    expect(onCardKey.mock.calls.map(([key]) => key)).toEqual(["Enter", "ArrowRight", "m"]);
    await expect.element(menu()).not.toBeInTheDocument();
  });
});
