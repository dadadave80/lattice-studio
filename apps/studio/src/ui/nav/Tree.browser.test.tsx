import { useEffect, useState, type KeyboardEvent } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { KEY_CONTEXT_ATTRIBUTE } from "@/contracts";
import { renderWithStudio } from "../../../test/harness";
import { MenuItem } from "../overlays/MenuItem";
import { emulateForcedColors } from "../testing/axe";
import { Tree, type TreeProps } from "./Tree";
import type { TreeNode } from "./tree-model";

const NODES: TreeNode[] = [
  {
    id: "vault", label: "GovernedVault", children: [
      { id: "vault.transfer", label: "transfer(address,uint256)" },
      { id: "vault.transferFrom", label: "transferFrom(address,address,uint256)" },
    ],
  },
  {
    id: "erc20", label: "ERC20", children: [
      { id: "erc20.totalSupply", label: "totalSupply()", disabledReason: "Served by GovernedVault" },
      { id: "erc20.balanceOf", label: "balanceOf(address)" },
    ],
  },
  { id: "erc4626", label: "ERC4626", children: [{ id: "erc4626.asset", label: "asset()" }] },
  { id: "pausable", label: "Pausable" },
];

type HarnessProps = Partial<Omit<TreeProps, "expanded" | "selected">> & {
  expanded?: string[];
  selected?: string[];
  onSelect?: (ids: string[]) => void;
};

function Harness({ expanded: initialExpanded = [], selected: initialSelected = [], onSelect, ...rest }: HarnessProps) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [selected, setSelected] = useState(initialSelected);
  return (
    <>
      <button type="button">Before</button>
      <Tree
        label="Structure"
        nodes={NODES}
        expanded={expanded}
        onExpandedChange={setExpanded}
        selected={selected}
        onSelectedChange={(ids) => {
          setSelected(ids);
          onSelect?.(ids);
        }}
        {...rest}
      />
      <button type="button">After</button>
    </>
  );
}

const item = (name: string) => page.getByRole("treeitem", { name, exact: true });
const focusedId = () => (document.activeElement as HTMLElement | null)?.dataset.treeId;
const selectedIds = () =>
  [...document.querySelectorAll('[role="treeitem"][aria-selected="true"]')].map((el) => (el as HTMLElement).dataset.treeId);
const tabbables = () => [...document.querySelectorAll('[role="treeitem"][tabindex="0"]')];

describe("Tree structure", () => {
  test("a labelled tree of items with level, set size, position and expansion; the tree key context", async () => {
    await renderWithStudio(<Harness expanded={["erc20"]} multiSelect />);
    const tree = page.getByRole("tree", { name: "Structure" });
    await expect.element(tree).toHaveAttribute(KEY_CONTEXT_ATTRIBUTE, "tree");
    await expect.element(tree).toHaveAttribute("aria-multiselectable", "true");
    const balance = item("balanceOf(address)");
    await expect.element(balance).toHaveAttribute("aria-level", "2");
    await expect.element(balance).toHaveAttribute("aria-setsize", "2");
    await expect.element(balance).toHaveAttribute("aria-posinset", "2");
    expect(balance.element().hasAttribute("aria-expanded")).toBe(false);
    await expect.element(item("ERC20")).toHaveAttribute("aria-expanded", "true");
    await expect.element(item("GovernedVault")).toHaveAttribute("aria-expanded", "false");
    await expect.element(item("Pausable")).toHaveAttribute("aria-posinset", "4");
    expect(item("Pausable").element().getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
  });

  test("one Tab stop: the first item, else the selected one; Tab leaves the tree", async () => {
    await renderWithStudio(<Harness expanded={["vault"]} selected={["vault.transferFrom"]} />);
    expect(tabbables()).toHaveLength(1);
    await page.getByRole("button", { name: "Before" }).click();
    await userEvent.tab();
    expect(focusedId()).toBe("vault.transferFrom");
    await userEvent.keyboard("{ArrowUp}");
    expect(focusedId()).toBe("vault.transfer");
    expect(tabbables()).toHaveLength(1);
    expect(tabbables()[0]).toBe(document.activeElement);
    await userEvent.tab();
    await expect.element(page.getByRole("button", { name: "After" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(focusedId()).toBe("vault.transfer");
  });

  test("with nothing selected, Tab lands on the first item", async () => {
    await renderWithStudio(<Harness />);
    await page.getByRole("button", { name: "Before" }).click();
    await userEvent.tab();
    expect(focusedId()).toBe("vault");
  });
});

describe("Tree keys", () => {
  test("↓ ↑ Home End move, and selection follows focus in a single-select tree", async () => {
    await renderWithStudio(<Harness expanded={["vault"]} />);
    await item("GovernedVault").click();
    await userEvent.keyboard("{ArrowDown}");
    expect(focusedId()).toBe("vault.transfer");
    expect(selectedIds()).toEqual(["vault.transfer"]);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(focusedId()).toBe("erc20");
    await userEvent.keyboard("{End}");
    expect(focusedId()).toBe("pausable");
    expect(selectedIds()).toEqual(["pausable"]);
    await userEvent.keyboard("{ArrowDown}");
    expect(focusedId()).toBe("pausable");
    await userEvent.keyboard("{Home}");
    expect(focusedId()).toBe("vault");
    await userEvent.keyboard("{ArrowUp}");
    expect(focusedId()).toBe("vault");
  });

  test("→ opens a closed parent, then enters it, and does nothing on a leaf", async () => {
    await renderWithStudio(<Harness />);
    await item("ERC20").click();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(item("ERC20")).toHaveAttribute("aria-expanded", "true");
    expect(focusedId()).toBe("erc20");
    await userEvent.keyboard("{ArrowRight}");
    expect(focusedId()).toBe("erc20.totalSupply");
    await userEvent.keyboard("{ArrowDown}{ArrowRight}");
    expect(focusedId()).toBe("erc20.balanceOf");
  });

  test("← goes to the parent, then closes it", async () => {
    await renderWithStudio(<Harness expanded={["erc20"]} />);
    await item("balanceOf(address)").click();
    await userEvent.keyboard("{ArrowLeft}");
    expect(focusedId()).toBe("erc20");
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(item("ERC20")).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector('[data-tree-id="erc20.balanceOf"]')).toBeNull();
    await userEvent.keyboard("{ArrowLeft}");
    expect(focusedId()).toBe("erc20");
  });

  test("* opens every sibling of the focused item", async () => {
    await renderWithStudio(<Harness />);
    await item("ERC20").click();
    await userEvent.keyboard("*");
    await expect.element(item("GovernedVault")).toHaveAttribute("aria-expanded", "true");
    await expect.element(item("ERC20")).toHaveAttribute("aria-expanded", "true");
    await expect.element(item("ERC4626")).toHaveAttribute("aria-expanded", "true");
    expect(focusedId()).toBe("erc20");
  });

  test("Enter and double-click activate; a disabled item doesn't", async () => {
    const onActivate = vi.fn();
    await renderWithStudio(<Harness expanded={["erc20"]} onActivate={onActivate} />);
    await item("ERC20").click();
    await userEvent.keyboard("{Enter}");
    expect(onActivate).toHaveBeenLastCalledWith(expect.objectContaining({ id: "erc20" }));
    await item("Pausable").dblClick();
    expect(onActivate).toHaveBeenLastCalledWith(expect.objectContaining({ id: "pausable" }));
    expect(onActivate).toHaveBeenCalledTimes(2);
    await item("totalSupply()").click({ force: true });
    await userEvent.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  test("a disabled item is reachable, says why and can't be selected", async () => {
    await renderWithStudio(<Harness expanded={["erc20"]} selected={["erc20"]} />);
    await item("ERC20").click();
    await userEvent.keyboard("{ArrowDown}");
    const disabled = item("totalSupply()");
    await expect.element(disabled).toHaveFocus();
    await expect.element(disabled).toHaveAttribute("aria-disabled", "true");
    await expect.element(disabled).toHaveAccessibleDescription("Served by GovernedVault");
    expect(selectedIds()).toEqual(["erc20"]);
    await userEvent.keyboard(" ");
    await disabled.click({ force: true });
    expect(selectedIds()).toEqual(["erc20"]);
  });

  test("type-ahead jumps to the next matching name, and the buffer resets after a pause", async () => {
    await renderWithStudio(<Harness />);
    await item("GovernedVault").click();
    await userEvent.keyboard("p");
    expect(focusedId()).toBe("pausable");
    await new Promise((resolve) => setTimeout(resolve, 650));
    await userEvent.keyboard("erc4");
    expect(focusedId()).toBe("erc4626");
    await new Promise((resolve) => setTimeout(resolve, 650));
    await userEvent.keyboard("G");
    expect(focusedId()).toBe("vault");
  });

  test("the caller's key handler runs first and can take the key", async () => {
    const onItemKeyDown = vi.fn((event: KeyboardEvent<HTMLElement>, node: TreeNode) => {
      if (event.altKey && event.key === "ArrowDown") event.preventDefault();
      if (event.key === "Delete") event.preventDefault();
      return node;
    });
    await renderWithStudio(<Harness onItemKeyDown={onItemKeyDown} />);
    await item("GovernedVault").click();
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(focusedId()).toBe("vault");
    await userEvent.keyboard("{Delete}");
    const keys = onItemKeyDown.mock.calls.map(([event]) => event.key).filter((key) => key !== "Alt");
    expect(keys).toEqual(["ArrowDown", "Delete"]);
    expect(onItemKeyDown.mock.calls[0]?.[1]).toMatchObject({ id: "vault" });
    await userEvent.keyboard("{ArrowDown}");
    expect(focusedId()).toBe("erc20");
  });
});

describe("Tree pointer", () => {
  test("click selects and focuses; the chevron toggles without selecting", async () => {
    await renderWithStudio(<Harness selected={["pausable"]} />);
    await item("ERC4626").click();
    expect(selectedIds()).toEqual(["erc4626"]);
    expect(focusedId()).toBe("erc4626");
    const chevron = item("GovernedVault").element().querySelector<HTMLElement>("[data-tree-toggle]");
    expect(chevron).not.toBeNull();
    const rect = (chevron as HTMLElement).getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(24);
    expect(rect.height).toBeGreaterThanOrEqual(24);
    (chevron as HTMLElement).click();
    await expect.element(item("GovernedVault")).toHaveAttribute("aria-expanded", "true");
    expect(selectedIds()).toEqual(["erc4626"]);
    (chevron as HTMLElement).click();
    await expect.element(item("GovernedVault")).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Tree multi-select", () => {
  test("arrows move without selecting; Space toggles; Shift + arrows extend", async () => {
    await renderWithStudio(<Harness expanded={["vault"]} multiSelect />);
    await item("GovernedVault").click();
    expect(selectedIds()).toEqual(["vault"]);
    await userEvent.keyboard("{ArrowDown}");
    expect(focusedId()).toBe("vault.transfer");
    expect(selectedIds()).toEqual(["vault"]);
    await userEvent.keyboard(" ");
    expect(selectedIds()).toEqual(["vault", "vault.transfer"]);
    await userEvent.keyboard(" ");
    expect(selectedIds()).toEqual(["vault"]);
    await userEvent.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}");
    expect(focusedId()).toBe("erc20");
    expect(selectedIds()).toEqual(["vault.transfer", "vault.transferFrom", "erc20"]);
    await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(selectedIds()).toEqual(["vault.transfer", "vault.transferFrom"]);
  });

  test("Ctrl/⌘+A selects every visible item that can be selected", async () => {
    await renderWithStudio(<Harness expanded={["erc20"]} multiSelect />);
    await item("GovernedVault").click();
    await userEvent.keyboard("{Control>}a{/Control}");
    expect(selectedIds()).toEqual(["vault", "erc20", "erc20.balanceOf", "erc4626", "pausable"]);
  });

  test("Ctrl-click toggles and Shift-click selects a range", async () => {
    await renderWithStudio(<Harness multiSelect />);
    await item("GovernedVault").click();
    await item("ERC4626").click({ modifiers: ["ControlOrMeta"] });
    expect(selectedIds()).toEqual(["vault", "erc4626"]);
    await item("GovernedVault").click({ modifiers: ["ControlOrMeta"] });
    expect(selectedIds()).toEqual(["erc4626"]);
    await item("ERC20").click();
    await item("Pausable").click({ modifiers: ["Shift"] });
    expect(selectedIds()).toEqual(["erc20", "erc4626", "pausable"]);
  });
});

describe("Tree focus from outside", () => {
  test("a controlled focus change moves the Tab stop without taking focus", async () => {
    function Controlled() {
      const [focused, setFocused] = useState<string | null>(null);
      return (
        <>
          <button type="button" onClick={() => setFocused("erc4626")}>Locate ERC4626</button>
          <Harness focusedId={focused} onFocusedChange={setFocused} />
        </>
      );
    }
    await renderWithStudio(<Controlled />);
    const locate = page.getByRole("button", { name: "Locate ERC4626" });
    await locate.click();
    await expect.element(locate).toHaveFocus();
    await expect.element(item("ERC4626")).toHaveAttribute("tabindex", "0");
    expect(tabbables()).toHaveLength(1);
    await item("Pausable").click();
    expect(focusedId()).toBe("pausable");
    await userEvent.keyboard("{ArrowUp}");
    expect(focusedId()).toBe("erc4626");
  });
});

describe("Tree item menus", () => {
  const menu = () => page.getByRole("menu");
  const withMenu = (onMove = vi.fn()) => ({
    itemMenu: (node: TreeNode) =>
      node.id === "pausable" ? null : (
        <>
          <MenuItem label="Move to…" onSelect={() => onMove(node.id)} />
          <MenuItem label="Open source" onSelect={() => {}} />
        </>
      ),
  });

  test("Shift+F10 on the focused item opens its menu on the first item; Esc returns focus to the item", async () => {
    await renderWithStudio(<Harness {...withMenu()} />);
    await page.getByRole("button", { name: "Before" }).click();
    await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}");
    expect(focusedId()).toBe("erc20");
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await expect.element(page.getByRole("menu", { name: "ERC20 actions" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Move to…" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(menu()).not.toBeInTheDocument();
    expect(focusedId()).toBe("erc20");
    await userEvent.keyboard("{ArrowDown}");
    expect(focusedId()).toBe("erc4626");
  });

  test("a right click opens it too, with the caller's label; an item without a menu has none", async () => {
    const onMove = vi.fn();
    await renderWithStudio(<Harness {...withMenu(onMove)} itemMenuLabel={(node) => `${node.label} menu`} />);
    await item("ERC4626").click({ button: "right" });
    await expect.element(page.getByRole("menu", { name: "ERC4626 menu" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Move to…" }).click();
    expect(onMove).toHaveBeenCalledWith("erc4626");
    await expect.element(menu()).not.toBeInTheDocument();
    await item("Pausable").click();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(focusedId()).toBe("pausable");
  });

  test("a disabled item with a menu: right click and Shift+F10 open it, and hover still shows the reason", async () => {
    await renderWithStudio(<Harness expanded={["erc20"]} {...withMenu()} />);
    const disabled = item("totalSupply()");
    await disabled.click({ button: "right", force: true });
    await expect.element(page.getByRole("menu", { name: "totalSupply() actions" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(menu()).not.toBeInTheDocument();
    await expect.element(disabled).toHaveFocus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await expect.element(page.getByRole("menu", { name: "totalSupply() actions" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Move to…" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(disabled).toHaveFocus();
    await expect.element(disabled).toHaveAccessibleDescription("Served by GovernedVault");
    // Focus opened the tooltip (L354); clicking away starts its close transition. Wait for it to finish
    // closing before hovering, so the hover isn't racing a tooltip that's already mid-close (flaky otherwise).
    await page.getByRole("button", { name: "Before" }).click();
    await expect.poll(() => document.querySelector("[data-tooltip]")).toBeNull();
    await disabled.hover();
    await expect.poll(() => document.querySelector("[data-tooltip]")?.textContent, { timeout: 2_000 }).toBe(
      "Served by GovernedVault",
    );
  });

  /** A tree whose ERC20 item's menu the test turns on and off (a rerender, not a remount). */
  function toggledMenu(initial: boolean) {
    const control = { set: (_on: boolean) => {} };
    function Toggled() {
      const [on, setOn] = useState(initial);
      useEffect(() => {
        control.set = setOn;
      }, []);
      return (
        <Harness
          itemMenu={(node) => (on || node.id !== "erc20" ? <MenuItem label="Open source" onSelect={() => {}} /> : null)}
          itemProps={() => ({ "data-menu-on": on })}
        />
      );
    }
    const turn = async (on: boolean) => {
      control.set(on);
      await expect.element(item("ERC20")).toHaveAttribute("data-menu-on", String(on));
    };
    return { Toggled, turn };
  }

  test("a focused item keeps its element and focus when its menu appears or goes", async () => {
    const { Toggled, turn } = toggledMenu(false);
    await renderWithStudio(<Toggled />);
    await item("ERC20").click();
    const before = item("ERC20").element();
    await expect.element(item("ERC20")).toHaveFocus();
    await turn(true);
    expect(item("ERC20").element()).toBe(before);
    await expect.element(item("ERC20")).toHaveFocus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await expect.element(page.getByRole("menu", { name: "ERC20 actions" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(item("ERC20")).toHaveFocus();
    await turn(false);
    expect(item("ERC20").element()).toBe(before);
    await expect.element(item("ERC20")).toHaveFocus();
  });

  test("a menu whose item loses it while open closes, and doesn't reopen when the menu comes back", async () => {
    const { Toggled, turn } = toggledMenu(true);
    await renderWithStudio(<Toggled />);
    await item("ERC20").click({ button: "right" });
    await expect.element(page.getByRole("menu", { name: "ERC20 actions" })).toBeVisible();
    await turn(false);
    await expect.element(menu()).not.toBeInTheDocument();
    await turn(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  test("virtualized rows keep their place with a menu", async () => {
    const big: TreeNode[] = Array.from({ length: 300 }, (_, i) => ({ id: `row-${i + 1}`, label: `Row ${i + 1}` }));
    await renderWithStudio(
      <Tree
        label="Large tree"
        nodes={big}
        expanded={[]}
        onExpandedChange={() => {}}
        selected={[]}
        onSelectedChange={() => {}}
        itemMenu={() => <MenuItem label="Open source" onSelect={() => {}} />}
        style={{ height: 280 }}
      />,
    );
    const second = item("Row 2").element() as HTMLElement;
    expect(getComputedStyle(second).position).toBe("absolute");
    expect(second.style.top).toBe("28px");
  });
});

describe("Tree item clicks and row attributes", () => {
  test("onItemClick fires on every click, the selected item and a disabled one included, not on the chevron", async () => {
    const onItemClick = vi.fn();
    const onSelect = vi.fn();
    await renderWithStudio(<Harness expanded={["erc20"]} onItemClick={onItemClick} onSelect={onSelect} />);
    await item("Pausable").click();
    await item("Pausable").click();
    expect(onItemClick.mock.calls.map(([node]) => (node as TreeNode).id)).toEqual(["pausable", "pausable"]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    await item("totalSupply()").click({ force: true });
    expect(onItemClick).toHaveBeenLastCalledWith(expect.objectContaining({ id: "erc20.totalSupply" }), expect.anything());
    item("GovernedVault").element().querySelector<HTMLElement>("[data-tree-toggle]")?.click();
    await expect.element(item("GovernedVault")).toHaveAttribute("aria-expanded", "true");
    expect(onItemClick).toHaveBeenCalledTimes(3);
  });

  test("itemProps adds data attributes and handlers to the row; the tree keeps its own", async () => {
    const onDragStart = vi.fn();
    const onActivate = vi.fn();
    await renderWithStudio(
      <Harness
        onActivate={onActivate}
        itemProps={(node) => ({
          "data-facet": node.id,
          draggable: true,
          onDragStart: () => onDragStart(node.id),
          role: "button",
          className: "caller-row",
          style: { paddingInlineStart: 99, opacity: 0.9 },
        })}
      />,
    );
    const row = item("ERC4626").element() as HTMLElement;
    expect(row.dataset.facet).toBe("erc4626");
    expect(row.getAttribute("role")).toBe("treeitem");
    expect(row.dataset.treeId).toBe("erc4626");
    expect(row.classList.contains("caller-row")).toBe(true);
    expect(row.getAttribute("draggable")).toBe("true");
    expect(row.style.opacity).toBe("0.9");
    expect(row.style.paddingInlineStart).not.toBe("99px");
    row.dispatchEvent(new DragEvent("dragstart", { bubbles: true }));
    expect(onDragStart).toHaveBeenCalledWith("erc4626");
    await item("ERC4626").click();
    expect(focusedId()).toBe("erc4626");
    await userEvent.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: "erc4626" }));
  });
});

describe("Tree disabled reason", () => {
  const tooltip = () => document.querySelector<HTMLElement>("[data-tooltip]");

  test("shows in a tooltip on hover and on focus, and stays the description", async () => {
    await renderWithStudio(<Harness expanded={["erc20"]} />);
    const disabled = item("totalSupply()");
    await expect.element(disabled).toHaveAccessibleDescription("Served by GovernedVault");
    await disabled.hover();
    await expect.poll(() => tooltip()?.textContent).toBe("Served by GovernedVault");
    await page.getByRole("button", { name: "Before" }).hover();
    await expect.poll(tooltip).toBeNull();
    await page.getByRole("button", { name: "Before" }).click();
    await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await expect.element(disabled).toHaveFocus();
    await expect.poll(() => tooltip()?.textContent).toBe("Served by GovernedVault");
  });
});

describe("Tree focus loss", () => {
  function Shrinking() {
    const [nodes, setNodes] = useState<TreeNode[]>(NODES);
    const [expanded, setExpanded] = useState<string[]>(["vault"]);
    return (
      <>
        <button type="button">Before</button>
        <Tree
          label="Structure"
          nodes={nodes}
          expanded={expanded}
          onExpandedChange={setExpanded}
          selected={[]}
          onSelectedChange={() => {}}
          multiSelect
          onItemKeyDown={(event, node) => {
            if (event.key === "Delete") {
              event.preventDefault();
              setNodes((list) => list.filter((other) => other.id !== node.id));
            }
            if (event.key === "c") {
              event.preventDefault();
              setExpanded([]);
            }
          }}
        />
      </>
    );
  }

  test("removing the focused item hands focus to the item that takes Tab", async () => {
    await renderWithStudio(<Shrinking />);
    await page.getByRole("button", { name: "Before" }).click();
    await userEvent.tab();
    await userEvent.keyboard("{End}");
    expect(focusedId()).toBe("pausable");
    await userEvent.keyboard("{Delete}");
    expect(document.querySelector('[data-tree-id="pausable"]')).toBeNull();
    await expect.poll(focusedId).toBe("vault");
    expect(tabbables()).toEqual([document.activeElement]);
  });

  test("the caller closing the focused item's parent does the same", async () => {
    await renderWithStudio(<Shrinking />);
    await page.getByRole("button", { name: "Before" }).click();
    await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}");
    expect(focusedId()).toBe("vault.transfer");
    await userEvent.keyboard("c");
    expect(document.querySelector('[data-tree-id="vault.transfer"]')).toBeNull();
    await expect.poll(focusedId).toBe("vault");
  });

  test("a change after focus has left the tree doesn't pull focus back", async () => {
    await renderWithStudio(<Shrinking />);
    await item("Pausable").click();
    const before = page.getByRole("button", { name: "Before" });
    await before.click();
    await expect.element(before).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    item("ERC4626").element().dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    await expect.poll(() => document.querySelector('[data-tree-id="erc4626"]')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("Tree under forced colors", () => {
  afterEach(async () => {
    await emulateForcedColors(false);
  });

  test("a focused selected item's ring differs from its fill", async () => {
    await renderWithStudio(<Harness selected={["erc20"]} />);
    await emulateForcedColors(true);
    await page.getByRole("button", { name: "Before" }).click();
    await userEvent.tab();
    const row = item("ERC20").element();
    await expect.element(item("ERC20")).toHaveFocus();
    const css = getComputedStyle(row);
    expect(css.outlineStyle).toBe("solid");
    expect(css.outlineColor).not.toBe(css.backgroundColor);
  });
});

describe("Tree virtualization", () => {
  const big: TreeNode[] = Array.from({ length: 1000 }, (_, i) => ({ id: `row-${i + 1}`, label: `Row ${i + 1}` }));

  function Big() {
    const [selected, setSelected] = useState<string[]>([]);
    return (
      <Tree
        label="Large tree"
        nodes={big}
        expanded={[]}
        onExpandedChange={() => {}}
        selected={selected}
        onSelectedChange={setSelected}
        style={{ height: 280 }}
      />
    );
  }

  test("renders far fewer rows than it has, and End reaches the last one", async () => {
    await renderWithStudio(<Big />);
    const rows = () => document.querySelectorAll('[role="treeitem"]');
    expect(rows().length).toBeGreaterThan(5);
    expect(rows().length).toBeLessThan(60);
    await item("Row 1").click();
    await userEvent.keyboard("{End}");
    await expect.poll(focusedId).toBe("row-1000");
    const last = item("Row 1000");
    await expect.element(last).toHaveAttribute("aria-posinset", "1000");
    await expect.element(last).toHaveAttribute("aria-setsize", "1000");
    await expect.element(last).toHaveAttribute("aria-selected", "true");
    expect(rows().length).toBeLessThan(60);
    const tree = page.getByRole("tree", { name: "Large tree" }).element();
    const box = tree.getBoundingClientRect();
    const lastBox = last.element().getBoundingClientRect();
    expect(lastBox.bottom).toBeLessThanOrEqual(box.bottom + 1);
    expect(lastBox.top).toBeGreaterThanOrEqual(box.top - 1);
    await userEvent.keyboard("{ArrowUp}");
    await expect.poll(focusedId).toBe("row-999");
    await userEvent.keyboard("{Home}");
    await expect.poll(focusedId).toBe("row-1");
    await expect.element(item("Row 1")).toHaveAttribute("aria-posinset", "1");
  });

  test("the focused row stays in the DOM while scrolled away, so Tab still reaches the tree", async () => {
    await renderWithStudio(
      <>
        <button type="button">Before</button>
        <Big />
      </>,
    );
    await item("Row 1").click();
    const tree = page.getByRole("tree", { name: "Large tree" }).element();
    tree.scrollTop = 28 * 500;
    tree.dispatchEvent(new Event("scroll"));
    await expect.poll(() => document.querySelector('[data-tree-id="row-500"]')).not.toBeNull();
    expect(document.querySelector('[data-tree-id="row-1"]')).not.toBeNull();
    await page.getByRole("button", { name: "Before" }).click();
    await userEvent.tab();
    expect(focusedId()).toBe("row-1");
  });
});
