import { useEffect, useState } from "react";
import { describe, expect, onTestFinished, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { ContextMenu } from "./ContextMenu";
import { MenuItem } from "./MenuItem";
import { MenuSeparator } from "./MenuSeparator";

function Card({
  onLocate = () => {}, onCardKey = () => {}, disabled,
}: { onLocate?: () => void; onCardKey?: (key: string) => void; disabled?: boolean }) {
  return (
    <div style={{ padding: 40 }}>
      <ContextMenu
        label="ERC20 actions"
        {...(disabled === undefined ? {} : { disabled })}
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

  test("Shift+F10 opens it while the target's own onKeyDown still runs for its other keys", async () => {
    const onCardKey = vi.fn();
    await renderWithStudio(<Card onCardKey={onCardKey} />);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await expect.element(menu()).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Open in inspector" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(menu()).not.toBeInTheDocument();
    await expect.element(card()).toHaveFocus();
    await userEvent.keyboard("m");
    const keys = onCardKey.mock.calls.map(([key]) => key);
    expect(keys).toContain("ArrowRight");
    expect(keys.at(-1)).toBe("m");
    await expect.element(menu()).not.toBeInTheDocument();
  });
});

describe("ContextMenu, controlled", () => {
  function Row({ onOpenChange, decline = false }: { onOpenChange: (open: boolean) => void; decline?: boolean }) {
    const [open, setOpen] = useState(false);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [anchored, setAnchored] = useState(true);
    const change = (next: boolean) => {
      onOpenChange(next);
      setOpen(next);
    };
    return (
      <div style={{ padding: 40 }}>
        <button type="button" onClick={() => change(true)}>
          Show actions
        </button>
        <button type="button" onClick={() => setAnchored(false)}>
          Drop anchor
        </button>
        <div ref={setAnchor} data-testid="anchor" style={{ marginBlock: 40, inlineSize: 120, blockSize: 24 }} />
        <ContextMenu
          label="Row actions"
          open={open}
          onOpenChange={(next) => {
            if (next && decline) onOpenChange(next);
            else change(next);
          }}
          anchor={anchored ? anchor : null}
          items={
            <>
              <MenuItem label="Rename" onSelect={() => {}} />
              <MenuItem label="Delete" onSelect={() => {}} />
            </>
          }
        >
          <div role="treeitem" aria-selected="false" tabIndex={0} style={{ inlineSize: 200, blockSize: 28, marginBlockStart: 80 }}>
            ERC20
          </div>
        </ContextMenu>
      </div>
    );
  }

  const rowMenu = () => page.getByRole("menu", { name: "Row actions" });

  test("opened by its owner, it sits below the anchor with focus on the first item; Esc asks to close", async () => {
    const onOpenChange = vi.fn();
    await renderWithStudio(<Row onOpenChange={onOpenChange} />);
    await page.getByRole("button", { name: "Show actions" }).click();
    await expect.element(rowMenu()).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
    const anchor = page.getByTestId("anchor").element().getBoundingClientRect();
    const popup = rowMenu().element().getBoundingClientRect();
    expect(Math.abs(popup.left - anchor.left)).toBeLessThanOrEqual(8);
    expect(popup.top).toBeGreaterThanOrEqual(anchor.bottom);
    await userEvent.keyboard("{Escape}");
    await expect.element(rowMenu()).not.toBeInTheDocument();
    expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([true, false]);
  });

  test("without an anchor, a programmatic open sits below the target", async () => {
    await renderWithStudio(<Row onOpenChange={() => {}} />);
    await page.getByRole("button", { name: "Drop anchor" }).click();
    const target = page.getByRole("treeitem").element().getBoundingClientRect();
    await page.getByRole("button", { name: "Show actions" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
    const popup = rowMenu().element().getBoundingClientRect();
    expect(Math.abs(popup.left - target.left)).toBeLessThanOrEqual(8);
    expect(popup.top).toBeGreaterThanOrEqual(target.bottom);
  });

  test("a right click still opens it at the pointer, through onOpenChange", async () => {
    const onOpenChange = vi.fn();
    await renderWithStudio(<Row onOpenChange={onOpenChange} />);
    const row = page.getByRole("treeitem");
    const rect = row.element().getBoundingClientRect();
    await row.click({ button: "right", position: { x: 150, y: 10 } });
    await expect.element(rowMenu()).toBeVisible();
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(Math.abs(rowMenu().element().getBoundingClientRect().left - (rect.left + 150))).toBeLessThanOrEqual(8);
    await userEvent.keyboard("{Escape}");
    await expect.element(rowMenu()).not.toBeInTheDocument();
    // The next programmatic open goes back below the anchor.
    await page.getByRole("button", { name: "Show actions" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
    const anchor = page.getByTestId("anchor").element().getBoundingClientRect();
    expect(Math.abs(rowMenu().element().getBoundingClientRect().left - anchor.left)).toBeLessThanOrEqual(8);
  });

  test("a right click its owner declined doesn't misplace the next programmatic open", async () => {
    const onOpenChange = vi.fn();
    await renderWithStudio(<Row onOpenChange={onOpenChange} decline />);
    await page.getByRole("treeitem").click({ button: "right", position: { x: 150, y: 10 } });
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await page.getByRole("button", { name: "Show actions" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
    const anchor = page.getByTestId("anchor").element().getBoundingClientRect();
    const popup = page.getByRole("menu", { name: "Row actions" }).element().getBoundingClientRect();
    expect(Math.abs(popup.left - anchor.left)).toBeLessThanOrEqual(8);
    expect(popup.top).toBeGreaterThanOrEqual(anchor.bottom);
  });
});

describe("ContextMenu, touch", () => {
  function touch(type: "touchstart" | "touchend", target: Element, x: number, y: number) {
    const point = new Touch({ identifier: 1, target, clientX: x, clientY: y });
    const touches = type === "touchstart" ? [point] : [];
    target.dispatchEvent(
      new TouchEvent(type, { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: [point] }),
    );
  }

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  test("a long press opens it at the touch point", async () => {
    await renderWithStudio(<Card />);
    const target = card().element();
    const rect = target.getBoundingClientRect();
    const x = rect.left + 100;
    const y = rect.top + 60;
    touch("touchstart", target, x, y);
    await wait(650);
    touch("touchend", target, x, y);
    await expect.element(menu()).toBeVisible();
    const popup = menu().element().getBoundingClientRect();
    expect(Math.abs(popup.left - x)).toBeLessThanOrEqual(16);
    expect(Math.abs(popup.top - y)).toBeLessThanOrEqual(16);
  });

  test("a short tap doesn't", async () => {
    await renderWithStudio(<Card />);
    const target = card().element();
    const rect = target.getBoundingClientRect();
    touch("touchstart", target, rect.left + 100, rect.top + 60);
    await wait(100);
    touch("touchend", target, rect.left + 100, rect.top + 60);
    await wait(600);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  test("a long press opens nothing while disabled", async () => {
    await renderWithStudio(<Card disabled />);
    const target = card().element();
    const rect = target.getBoundingClientRect();
    touch("touchstart", target, rect.left + 100, rect.top + 60);
    await wait(650);
    touch("touchend", target, rect.left + 100, rect.top + 60);
    await wait(100);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});

describe("ContextMenu, disabled", () => {
  /** Each keydown that reached the window, and whether something on the way took it (default prevented). */
  function watchKeys() {
    const seen: { key: string; taken: boolean }[] = [];
    const onKeyDown = (event: KeyboardEvent) => seen.push({ key: event.key, taken: event.defaultPrevented });
    window.addEventListener("keydown", onKeyDown);
    onTestFinished(() => window.removeEventListener("keydown", onKeyDown));
    return seen;
  }

  /**
   * Fires a `contextmenu` on the target, as a right click does, and says whether the page cancelled it. The
   * browser shows its own menu exactly when it isn't cancelled.
   */
  function rightClickCancelled(target: Element): boolean {
    const rect = target.getBoundingClientRect();
    const event = new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, button: 2, clientX: rect.left + 20, clientY: rect.top + 20,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  test("a right click opens nothing and lets the browser's own menu through", async () => {
    await renderWithStudio(<Card disabled />);
    expect(rightClickCancelled(card().element())).toBe(false);
    await card().click({ button: "right" });
    await wait(100);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  test("enabled, the same right click is taken by the menu", async () => {
    await renderWithStudio(<Card disabled={false} />);
    expect(rightClickCancelled(card().element())).toBe(true);
    await expect.element(menu()).toBeVisible();
  });

  test("Shift+F10 and the Menu key open nothing and pass through to the target", async () => {
    const seen = watchKeys();
    const onCardKey = vi.fn();
    await renderWithStudio(<Card disabled onCardKey={onCardKey} />);
    await userEvent.tab();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await userEvent.keyboard("{ContextMenu}");
    await wait(100);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(onCardKey.mock.calls.map(([key]) => key)).toEqual(["Shift", "F10", "ContextMenu"]);
    expect(seen.filter(({ key }) => key === "F10" || key === "ContextMenu")).toEqual([
      { key: "F10", taken: false },
      { key: "ContextMenu", taken: false },
    ]);
    await expect.element(card()).toHaveFocus();
  });

  test("an open menu closes once disabled and doesn't reopen when enabled again", async () => {
    const control = { set: (_disabled: boolean) => {} };
    function Toggled() {
      const [disabled, setDisabled] = useState(false);
      useEffect(() => {
        control.set = setDisabled;
      }, []);
      return <Card disabled={disabled} />;
    }
    await renderWithStudio(<Toggled />);
    await card().click({ button: "right" });
    await expect.element(menu()).toBeVisible();
    control.set(true);
    await expect.element(menu()).not.toBeInTheDocument();
    control.set(false);
    await wait(150);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  test("an owner's open is ignored while disabled, and an open menu asks its owner to close once disabled", async () => {
    const control = { set: (_state: { open: boolean; disabled: boolean }) => {} };
    function Owned() {
      const [state, setState] = useState({ open: false, disabled: true });
      useEffect(() => {
        control.set = setState;
      }, []);
      return (
        <ContextMenu
          label="Row actions"
          open={state.open}
          onOpenChange={(open) => setState((current) => ({ ...current, open }))}
          disabled={state.disabled}
          items={<MenuItem label="Rename" onSelect={() => {}} />}
        >
          <div
            role="treeitem"
            aria-selected="false"
            tabIndex={0}
            data-menu-open={String(state.open)}
            data-menu-disabled={String(state.disabled)}
          >
            ERC20
          </div>
        </ContextMenu>
      );
    }
    await renderWithStudio(<Owned />);
    const row = page.getByRole("treeitem", { name: "ERC20" });
    control.set({ open: true, disabled: true });
    // Asked to close at once, so the owner's open never shows a menu.
    await expect.element(row).toHaveAttribute("data-menu-open", "false");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    control.set({ open: true, disabled: false });
    await expect.element(page.getByRole("menu", { name: "Row actions" })).toBeVisible();
    control.set({ open: true, disabled: true });
    await expect.element(page.getByRole("menu", { name: "Row actions" })).not.toBeInTheDocument();
    await expect.element(row).toHaveAttribute("data-menu-open", "false");
  });

  test("a keyboard-opened menu that closes because it's disabled leaves focus on its target", async () => {
    const control = { set: (_disabled: boolean) => {} };
    function Toggled() {
      const [disabled, setDisabled] = useState(false);
      useEffect(() => {
        control.set = setDisabled;
      }, []);
      return <Card disabled={disabled} />;
    }
    await renderWithStudio(<Toggled />);
    await userEvent.tab();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await expect.element(page.getByRole("menuitem", { name: "Open in inspector" })).toHaveFocus();
    control.set(true);
    await expect.element(menu()).not.toBeInTheDocument();
    await expect.element(card()).toHaveFocus();
  });

  /** A menu whose owner watches it; the test disables it and rerenders the owner at will. */
  function watched(controlled: "controlled" | "uncontrolled", obey: boolean) {
    const control = { set: (_disabled: boolean) => {}, rerender: () => {} };
    const asks: boolean[] = [];
    function Owner() {
      const [disabled, setDisabled] = useState(false);
      const [open, setOpen] = useState(false);
      const [, setTick] = useState(0);
      useEffect(() => {
        control.set = setDisabled;
        control.rerender = () => setTick((tick) => tick + 1);
      }, []);
      return (
        <ContextMenu
          label="Row actions"
          disabled={disabled}
          {...(controlled === "controlled" ? { open } : {})}
          // A new callback every render, as an inline owner passes.
          onOpenChange={(next) => {
            asks.push(next);
            if (next || obey) setOpen(next);
          }}
          items={<MenuItem label="Rename" onSelect={() => {}} />}
        >
          <div role="treeitem" aria-selected="false" tabIndex={0}>
            ERC20
          </div>
        </ContextMenu>
      );
    }
    return { Owner, control, asks };
  }

  for (const mode of ["controlled", "uncontrolled"] as const) {
    test(`disabling an open ${mode} menu tells its owner once, even as the owner rerenders`, async () => {
      const { Owner, control, asks } = watched(mode, mode === "uncontrolled");
      await renderWithStudio(<Owner />);
      await page.getByRole("treeitem", { name: "ERC20" }).click({ button: "right" });
      await expect.element(page.getByRole("menu", { name: "Row actions" })).toBeVisible();
      control.set(true);
      await expect.element(page.getByRole("menu", { name: "Row actions" })).not.toBeInTheDocument();
      for (let i = 0; i < 3; i += 1) {
        control.rerender();
        await wait(20);
      }
      expect(asks).toEqual([true, false]);
    });
  }

  test("the target keeps its element and focus as its menu is disabled and enabled", async () => {
    const control = { set: (_disabled: boolean) => {} };
    function Toggled() {
      const [disabled, setDisabled] = useState(false);
      useEffect(() => {
        control.set = setDisabled;
      }, []);
      return <Card disabled={disabled} />;
    }
    await renderWithStudio(<Toggled />);
    await userEvent.tab();
    const before = card().element();
    for (const disabled of [true, false, true, false]) {
      control.set(disabled);
      await wait(50);
      expect(card().element()).toBe(before);
      await expect.element(card()).toHaveFocus();
    }
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await expect.element(menu()).toBeVisible();
  });
});
