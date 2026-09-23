import { useState, type KeyboardEvent } from "react";
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { KEY_CONTEXT_ATTRIBUTE } from "@/contracts";
import { renderWithStudio } from "../../../test/harness";
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
