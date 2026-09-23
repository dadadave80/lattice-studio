import { useEffect, useState, type ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { Button } from "../buttons/Button";
import { Checkbox } from "../fields/Checkbox";
import { RadioGroup } from "../fields/RadioGroup";
import { Select } from "../fields/Select";
import { Switch } from "../fields/Switch";
import { ToggleButton } from "../fields/ToggleButton";
import { Tabs } from "../nav/Tabs";
import { Toolbar } from "../nav/Toolbar";
import { ToolbarButton } from "../nav/ToolbarButton";
import { Tree } from "../nav/Tree";
import { Menu } from "../overlays/Menu";
import { MenuItem } from "../overlays/MenuItem";
import { ReasonTooltip } from "./ReasonTooltip";

// A control can turn disabled or enabled while it has focus (Undo after the last undo, Deploy while a check
// runs). It must keep its element, so focus stays where the person left it (spec L661, L753; WCAG 2.4.3).

const REASON = "Nothing to undo";

/** Renders `render(reason)` with a reason the test turns on and off: a rerender, never a remount. */
function flippable(render: (reason: string | null) => ReactNode) {
  const control = { set: (_reason: string | null) => {} };
  function Flipped() {
    const [reason, setReason] = useState<string | null>(null);
    useEffect(() => {
      control.set = setReason;
    }, []);
    return render(reason);
  }
  return { Flipped, set: (reason: string | null) => control.set(reason) };
}

type Locator = ReturnType<typeof page.getByRole>;

/** With `control` focused, turns its reason on, off and on: the same element keeps focus each time. */
async function expectFocusKept(control: () => Locator, set: (reason: string | null) => void) {
  await expect.element(control()).toHaveFocus();
  const before = control().element();
  for (const reason of [REASON, null, REASON, null]) {
    set(reason);
    if (reason) await expect.element(control()).toHaveAttribute("aria-disabled", "true");
    else await expect.element(control()).not.toHaveAttribute("aria-disabled", "true");
    expect(control().element()).toBe(before);
    await expect.element(control()).toHaveFocus();
  }
}

describe("a reason coming or going keeps the control and its focus", () => {
  test("any control in a ReasonTooltip, with and without a tooltip of its own", async () => {
    const { Flipped, set } = flippable((reason) => (
      <>
        <ReasonTooltip reason={reason}>
          <button type="button">Use a new salt</button>
        </ReasonTooltip>
        <ReasonTooltip reason={reason} content="Tidy layout">
          <button type="button">Tidy</button>
        </ReasonTooltip>
      </>
    ));
    await renderWithStudio(<Flipped />);
    await userEvent.tab();
    await expectFocusKept(() => page.getByRole("button", { name: "Use a new salt" }), set);
    await userEvent.tab();
    await expectFocusKept(() => page.getByRole("button", { name: "Tidy" }), set);
  });

  test("the reason's description comes and goes with it, and the control's own description stays", async () => {
    const { Flipped, set } = flippable((reason) => (
      <>
        <ReasonTooltip reason={reason}>
          <button type="button" aria-describedby="salt-help">
            Use a new salt
          </button>
        </ReasonTooltip>
        <span id="salt-help">Changes the deploy address</span>
      </>
    ));
    await renderWithStudio(<Flipped />);
    const button = page.getByRole("button", { name: "Use a new salt" });
    await expect.element(button).toHaveAccessibleDescription("Changes the deploy address");
    set(REASON);
    await expect.element(button).toHaveAccessibleDescription(`Changes the deploy address ${REASON}`);
    set(null);
    await expect.element(button).toHaveAccessibleDescription("Changes the deploy address");
    expect(button.element().textContent).toBe("Use a new salt");
  });

  test("a tooltip without content never opens once its reason goes", async () => {
    const { Flipped, set } = flippable((reason) => (
      <ReasonTooltip reason={reason}>
        <button type="button">Use a new salt</button>
      </ReasonTooltip>
    ));
    await renderWithStudio(<Flipped />);
    set(REASON);
    const button = page.getByRole("button", { name: "Use a new salt" });
    await button.click({ force: true });
    await expect.poll(() => document.querySelector("[data-tooltip]")?.textContent).toBe(REASON);
    set(null);
    await expect.poll(() => document.querySelector("[data-tooltip]")).toBeNull();
    await button.unhover();
    await button.hover();
    await userEvent.tab({ shift: true });
    await userEvent.tab();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(document.querySelector("[data-tooltip]")).toBeNull();
  });

  test("fields and toolbar buttons", async () => {
    const { Flipped, set } = flippable((reason) => (
      <>
        <Checkbox label="Keep immutable" disabledReason={reason} />
        <Switch label="Single-key shortcuts" disabledReason={reason} />
        <ToggleButton icon="undo" label="Show pins" disabledReason={reason} />
        <Select label="Network" options={[{ value: "anvil", label: "Anvil" }]} defaultValue="anvil" disabledReason={reason} />
        <RadioGroup label="Salt" options={[{ value: "new", label: "Use a new salt", disabledReason: reason }]} />
        <Toolbar label="Sheet tools">
          <ToolbarButton icon="undo" label="Tidy layout" disabledReason={reason} />
        </Toolbar>
      </>
    ));
    await renderWithStudio(<Flipped />);
    const controls = [
      () => page.getByRole("checkbox", { name: "Keep immutable" }),
      () => page.getByRole("switch", { name: "Single-key shortcuts" }),
      () => page.getByRole("button", { name: "Show pins" }),
      () => page.getByRole("combobox", { name: "Network" }),
      () => page.getByRole("radio", { name: "Use a new salt" }),
      () => page.getByRole("button", { name: "Tidy layout" }),
    ];
    for (const control of controls) {
      (control().element() as HTMLElement).focus();
      await expectFocusKept(control, set);
    }
  });

  test("a menu's trigger button, which opens the menu again once enabled", async () => {
    const { Flipped, set } = flippable((reason) => (
      <Menu label="Export" trigger={<Button disabledReason={reason}>Export</Button>}>
        <MenuItem label="Foundry script" onSelect={() => {}} />
      </Menu>
    ));
    await renderWithStudio(<Flipped />);
    await userEvent.tab();
    const trigger = () => page.getByRole("button", { name: "Export" });
    await expectFocusKept(trigger, set);
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("menu", { name: "Export" })).toBeVisible();
  });

  test("a menu item", async () => {
    const onSelect = vi.fn();
    const { Flipped, set } = flippable((reason) => (
      <Menu label="Edit" trigger={<Button>Edit</Button>}>
        <MenuItem label="Undo" onSelect={onSelect} disabledReason={reason} />
        <MenuItem label="Redo" onSelect={() => {}} />
      </Menu>
    ));
    await renderWithStudio(<Flipped />);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}");
    const item = () => page.getByRole("menuitem", { name: "Undo" });
    await expectFocusKept(item, set);
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test("a tab", async () => {
    function Panes({ reason }: { reason: string | null }) {
      const [value, setValue] = useState("catalog");
      return (
        <Tabs
          label="Left pane"
          value={value}
          onValueChange={setValue}
          tabs={[
            { value: "catalog", label: "Catalog" },
            { value: "structure", label: "Structure", disabledReason: reason },
          ]}
        />
      );
    }
    const { Flipped, set } = flippable((reason) => <Panes reason={reason} />);
    await renderWithStudio(<Flipped />);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    await expectFocusKept(() => page.getByRole("tab", { name: "Structure" }), set);
    // Enabled again, the tab is back to Base UI's own value.
    expect(page.getByRole("tab", { name: "Structure" }).element().getAttribute("aria-disabled")).toBe("false");
  });

  test("a tree row", async () => {
    function Structure({ reason }: { reason: string | null }) {
      const [selected, setSelected] = useState<string[]>([]);
      return (
        <Tree
          label="Structure"
          nodes={[
            { id: "erc20", label: "ERC20", ...(reason ? { disabledReason: reason } : {}) },
            { id: "ownable", label: "Ownable" },
          ]}
          expanded={[]}
          onExpandedChange={() => {}}
          selected={selected}
          onSelectedChange={setSelected}
        />
      );
    }
    const { Flipped, set } = flippable((reason) => <Structure reason={reason} />);
    await renderWithStudio(<Flipped />);
    await userEvent.tab();
    await expectFocusKept(() => page.getByRole("treeitem", { name: "ERC20" }), set);
  });

  test("a tree row with a menu", async () => {
    function Structure({ reason }: { reason: string | null }) {
      return (
        <Tree
          label="Structure"
          nodes={[{ id: "erc20", label: "ERC20", ...(reason ? { disabledReason: reason } : {}) }]}
          expanded={[]}
          onExpandedChange={() => {}}
          selected={[]}
          onSelectedChange={() => {}}
          itemMenu={() => <MenuItem label="Open source" onSelect={() => {}} />}
        />
      );
    }
    const { Flipped, set } = flippable((reason) => <Structure reason={reason} />);
    await renderWithStudio(<Flipped />);
    await userEvent.tab();
    await expectFocusKept(() => page.getByRole("treeitem", { name: "ERC20" }), set);
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await expect.element(page.getByRole("menu", { name: "ERC20 actions" })).toBeVisible();
  });
});
