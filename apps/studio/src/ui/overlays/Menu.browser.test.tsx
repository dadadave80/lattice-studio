import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command } from "@/contracts";
import { onCleanup, overrideCommands, renderWithStudio } from "../../../test/harness";
import { Button } from "../buttons/Button";
import { IconButton } from "../buttons/IconButton";
import { overridePlatform } from "../shared/platform";
import { Menu } from "./Menu";
import { MenuCheckboxItem } from "./MenuCheckboxItem";
import { MenuCommandItem } from "./MenuCommandItem";
import { MenuGroup } from "./MenuGroup";
import { MenuItem } from "./MenuItem";
import { MenuRadioGroup } from "./MenuRadioGroup";
import { MenuRadioItem } from "./MenuRadioItem";
import { MenuSeparator } from "./MenuSeparator";
import { Submenu } from "./Submenu";
import { axeViolations } from "../testing/axe";

function ExportMenu({ onFoundry = () => {}, onDisabled = () => {} }: { onFoundry?: () => void; onDisabled?: () => void }) {
  return (
    <Menu trigger={<Button>Export</Button>} label="Export">
      <MenuItem label="Foundry script" onSelect={onFoundry} shortcut="Mod+e" />
      <MenuItem label="Agent brief" onSelect={() => {}} />
      <MenuItem label="Safe batch" onSelect={onDisabled} disabledReason="Choose a Safe first" />
      <MenuSeparator />
      <MenuItem label="Share link" onSelect={() => {}} icon="share" />
    </Menu>
  );
}

const trigger = () => page.getByRole("button", { name: "Export" });
const item = (name: string) => page.getByRole("menuitem", { name });

describe("Menu", () => {
  for (const key of ["{Enter}", " ", "{ArrowDown}"]) {
    test(`${key === " " ? "Space" : key} on the trigger opens it on the first item`, async () => {
      await renderWithStudio(<ExportMenu />);
      await userEvent.tab();
      await expect.element(trigger()).toHaveFocus();
      await userEvent.keyboard(key);
      const menu = page.getByRole("menu", { name: "Export" });
      await expect.element(menu).toBeVisible();
      expect(menu.element().getAttribute("data-keyctx")).toBe("menu");
      await expect.element(item("Foundry script")).toHaveFocus();
    });
  }

  test("arrows, Home and End move; Esc closes and focus returns to the trigger", async () => {
    await renderWithStudio(<ExportMenu />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await expect.element(item("Foundry script")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(item("Agent brief")).toHaveFocus();
    await userEvent.keyboard("{End}");
    await expect.element(item("Share link")).toHaveFocus();
    await userEvent.keyboard("{Home}");
    await expect.element(item("Foundry script")).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(item("Share link")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
    await expect.element(trigger()).toHaveFocus();
  });

  test("a keyboard-focused item shows a solid 2 px focus ring", async () => {
    await renderWithStudio(<ExportMenu />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{ArrowDown}");
    const brief = item("Agent brief");
    await expect.element(brief).toHaveFocus();
    const style = getComputedStyle(brief.element());
    expect(style.outlineStyle).toBe("solid");
    expect(style.outlineWidth).toBe("2px");
  });

  test("typing moves to the matching item", async () => {
    await renderWithStudio(<ExportMenu />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("sh");
    await expect.element(item("Share link")).toHaveFocus();
  });

  test("a disabled item is focusable, inert, and says why", async () => {
    const onDisabled = vi.fn();
    await renderWithStudio(<ExportMenu onDisabled={onDisabled} />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    const safe = item("Safe batch");
    await expect.element(safe).toHaveFocus();
    expect(safe.element().getAttribute("aria-disabled")).toBe("true");
    await expect.element(safe).toHaveAccessibleName("Safe batch");
    await expect.element(safe).toHaveAccessibleDescription("Choose a Safe first");
    await expect.element(page.getByText("Choose a Safe first")).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await safe.click({ force: true });
    expect(onDisabled).not.toHaveBeenCalled();
    await expect.element(page.getByRole("menu")).toBeVisible();
  });

  test("a disabled item's accessible name is its visible label; the reason is its description (axe label-content-name-mismatch)", async () => {
    await renderWithStudio(<ExportMenu />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    const safe = item("Safe batch");
    await expect.element(safe).toBeVisible();
    await expect.element(safe).toHaveAccessibleName("Safe batch");
    await expect.element(safe).toHaveAccessibleDescription("Choose a Safe first");
    await expect.element(page.getByText("Choose a Safe first")).toBeVisible();
    const menu = page.getByRole("menu", { name: "Export" }).element();
    // axe reads an item's visible text only once the popup has faded in; before that the rule doesn't apply.
    await expect.poll(() => getComputedStyle(menu).opacity).toBe("1");
    expect(await axeViolations(menu, { rules: { "label-content-name-mismatch": { enabled: true } } })).toEqual([]);
  });

  describe("⌘/Ctrl+Enter on a focused item", () => {
    test("reaches the document-level handler and doesn't activate the item; plain Enter still does", async () => {
      const onFoundry = vi.fn();
      const seen: { defaultPrevented: boolean }[] = [];
      const listen = (event: KeyboardEvent) => {
        if (event.key === "Enter" && event.ctrlKey) seen.push({ defaultPrevented: event.defaultPrevented });
      };
      window.addEventListener("keydown", listen);
      onCleanup(() => window.removeEventListener("keydown", listen));
      await renderWithStudio(<ExportMenu onFoundry={onFoundry} />);
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      await expect.element(item("Foundry script")).toHaveFocus();
      await userEvent.keyboard("{Control>}{Enter}{/Control}");
      await expect.poll(() => seen.length).toBe(1);
      expect(seen[0]?.defaultPrevented).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(onFoundry).not.toHaveBeenCalled();
      await userEvent.keyboard("{Enter}");
      expect(onFoundry).toHaveBeenCalledTimes(1);
    });

    test("checkbox, radio and submenu items pass it on the same way", async () => {
      const seen: boolean[] = [];
      const listen = (event: KeyboardEvent) => {
        if (event.key === "Enter" && event.metaKey) seen.push(event.defaultPrevented);
      };
      window.addEventListener("keydown", listen);
      onCleanup(() => window.removeEventListener("keydown", listen));
      const toggled = vi.fn();
      await renderWithStudio(
        <Menu trigger={<Button>View</Button>} label="View">
          <MenuCheckboxItem label="Show minimap" checked={false} onCheckedChange={toggled} />
          <MenuRadioGroup label="Layout" value="shop" onValueChange={toggled}>
            <MenuRadioItem value="draft" label="Draft" />
          </MenuRadioGroup>
          <Submenu label="Move to…">
            <MenuItem label="Left" onSelect={toggled} />
          </Submenu>
        </Menu>,
      );
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      for (const step of ["", "{ArrowDown}", "{ArrowDown}"]) {
        if (step) await userEvent.keyboard(step);
        await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
      }
      await expect.poll(() => seen.length).toBe(3);
      expect(seen).toEqual([false, false, false]);
      expect(toggled).not.toHaveBeenCalled();
    });
  });

  test("an item runs on Enter and click, closes the menu, and shows its shortcut", async () => {
    onCleanup(overridePlatform("mac"));
    const onFoundry = vi.fn();
    await renderWithStudio(<ExportMenu onFoundry={onFoundry} />);
    await trigger().click();
    const foundry = item("Foundry script");
    expect(foundry.element().getAttribute("aria-keyshortcuts")).toBe("Meta+E");
    await expect.element(page.getByText("⌘E")).toBeVisible();
    await foundry.click();
    expect(onFoundry).toHaveBeenCalledTimes(1);
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Enter}");
    expect(onFoundry).toHaveBeenCalledTimes(2);
  });

  test("a single-key shortcut isn't announced while single-key shortcuts are off", async () => {
    onCleanup(overridePlatform("mac"));
    await renderWithStudio(
      <Menu trigger={<Button>Sheet</Button>} label="Sheet">
        <MenuItem label="Tidy layout" onSelect={() => {}} shortcut="Shift+t" />
        <MenuItem label="Save" onSelect={() => {}} shortcut="Mod+s" />
      </Menu>,
      { settings: { singleKeys: false } },
    );
    await page.getByRole("button", { name: "Sheet" }).click();
    expect(item("Tidy layout").element().hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(item("Save").element().getAttribute("aria-keyshortcuts")).toBe("Meta+S");
  });

  test("items are at least 24 px tall", async () => {
    await renderWithStudio(<ExportMenu />);
    await trigger().click();
    for (const name of ["Foundry script", "Safe batch", "Share link"]) {
      expect(item(name).element().getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    }
  });

  test("the menu is named by its label, not the trigger's own accessible name", async () => {
    await renderWithStudio(
      <Menu trigger={<Button>Lattice Studio</Button>} label="App menu">
        <MenuItem label="Settings" onSelect={() => {}} />
      </Menu>,
    );
    await page.getByRole("button", { name: "Lattice Studio" }).click();
    await expect.element(page.getByRole("menu", { name: "App menu" })).toBeVisible();
    expect(page.getByRole("menu", { name: "Lattice Studio" }).elements()).toHaveLength(0);
  });

  test("works with an IconButton trigger", async () => {
    await renderWithStudio(
      <Menu trigger={<IconButton icon="menu" label="App menu" />} label="App menu">
        <MenuItem label="Settings" onSelect={() => {}} />
      </Menu>,
    );
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("menuitem", { name: "Settings" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("button", { name: "App menu" })).toHaveFocus();
  });
});

describe("MenuCommandItem", () => {
  test("takes the command's title, shortcut and reason, and runs it from the menu", async () => {
    onCleanup(overridePlatform("mac"));
    const tidy = vi.fn();
    const deploy = vi.fn();
    overrideCommands([
      command({ id: "layout.tidy", title: () => "Tidy layout", category: "Sheet", keys: ["Shift+t"], enabled: () => ({ ok: true }), run: tidy }),
      command({
        id: "deploy.open",
        title: () => "Deploy…",
        category: "Deploy",
        enabled: () => ({ ok: false, reason: "Resolve 2 blockers · F8" }),
        run: deploy,
      }),
    ]);
    await renderWithStudio(
      <Menu trigger={<Button>Sheet</Button>} label="Sheet">
        <MenuCommandItem command={{ id: "layout.tidy" }} />
        <MenuCommandItem command={{ id: "deploy.open" }} />
      </Menu>,
    );
    await page.getByRole("button", { name: "Sheet" }).click();
    const tidyItem = item("Tidy layout");
    await expect.element(page.getByText("⇧T")).toBeVisible();
    const deployItem = item("Deploy…");
    await expect.element(deployItem).toHaveAccessibleDescription("Resolve 2 blockers · F8");
    await deployItem.click({ force: true });
    expect(deploy).not.toHaveBeenCalled();
    await tidyItem.click();
    expect(tidy).toHaveBeenCalledTimes(1);
    expect(tidy.mock.calls[0]?.[0]).toMatchObject({ source: "menu" });
  });
});

describe("Menu groups, checkbox and radio items, submenus", () => {
  function ViewMenu() {
    const [minimap, setMinimap] = useState(false);
    const [theme, setTheme] = useState("shop");
    return (
      <Menu trigger={<Button>View</Button>} label="View">
        <MenuGroup label="Sheet">
          <MenuCheckboxItem label="Minimap" checked={minimap} onCheckedChange={setMinimap} />
        </MenuGroup>
        <MenuRadioGroup label="Theme" value={theme} onValueChange={setTheme}>
          <MenuRadioItem value="shop" label="Shop" />
          <MenuRadioItem value="draft" label="Draft" />
        </MenuRadioGroup>
        <Submenu label="Move to…">
          <MenuItem label="Left of ERC4626" onSelect={() => {}} />
        </Submenu>
      </Menu>
    );
  }

  test("checkbox and radio items toggle and keep the menu open; groups are labelled", async () => {
    await renderWithStudio(<ViewMenu />);
    await page.getByRole("button", { name: "View" }).click();
    await expect.element(page.getByRole("group", { name: "Sheet" })).toBeVisible();
    const minimap = page.getByRole("menuitemcheckbox", { name: "Minimap" });
    await expect.element(minimap).not.toBeChecked();
    await minimap.click();
    await expect.element(minimap).toBeChecked();
    const draft = page.getByRole("menuitemradio", { name: "Draft" });
    await draft.click();
    await expect.element(draft).toBeChecked();
    await expect.element(page.getByRole("menuitemradio", { name: "Shop" })).not.toBeChecked();
  });

  test("→ opens a submenu on its first item and ← returns to it", async () => {
    await renderWithStudio(<ViewMenu />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{End}");
    await expect.element(item("Move to…")).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(item("Left of ERC4626")).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(item("Move to…")).toHaveFocus();
  });
});
