import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { settings } from "@/contracts";
import { onCleanup, renderWithStudio } from "../../../test/harness";
import { overridePlatform } from "../shared/platform";
import { Toolbar, type ToolbarProps } from "./Toolbar";
import { ToolbarButton } from "./ToolbarButton";
import { ToolbarGroup } from "./ToolbarGroup";
import { ToolbarSeparator } from "./ToolbarSeparator";

function Strip({ orientation, onTidy }: { orientation: ToolbarProps["orientation"]; onTidy: () => void }) {
  const [tool, setTool] = useState<"select" | "hand">("select");
  return (
    <>
      <button type="button">Before</button>
      <Toolbar label="Sheet tools" {...(orientation ? { orientation } : {})}>
        <ToolbarGroup>
          <ToolbarButton icon="select" label="Select" pressed={tool === "select"} onClick={() => setTool("select")} />
          <ToolbarButton icon="hand" label="Hand" pressed={tool === "hand"} onClick={() => setTool("hand")} />
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarButton icon="zoom-out" label="Zoom out" shortcut="-" />
        <ToolbarButton icon="tidy" label="Tidy" shortcut="t" disabledReason="Place facets first" onClick={onTidy} />
        <ToolbarButton icon="fit" label="Fit" />
      </Toolbar>
      <button type="button">After</button>
    </>
  );
}

const button = (name: string) => page.getByRole("button", { name, exact: true });

describe("Toolbar", () => {
  test("is one Tab stop and remembers where focus was", async () => {
    await renderWithStudio(<Strip orientation="vertical" onTidy={vi.fn()} />);
    await expect.element(page.getByRole("toolbar", { name: "Sheet tools" })).toHaveAttribute("aria-orientation", "vertical");
    await button("Before").click();
    await userEvent.tab();
    await expect.element(button("Select")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(button("Hand")).toHaveFocus();
    await userEvent.tab();
    await expect.element(button("After")).toHaveFocus();
    await userEvent.tab({ shift: true });
    await expect.element(button("Hand")).toHaveFocus();
  });

  test("vertical: ↑ ↓ move through every button, the disabled one included; Home and End", async () => {
    const onTidy = vi.fn();
    await renderWithStudio(<Strip orientation="vertical" onTidy={onTidy} />);
    await button("Select").click();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(button("Hand")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(button("Zoom out")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    const tidy = button("Tidy");
    await expect.element(tidy).toHaveFocus();
    await expect.element(tidy).toHaveAttribute("aria-disabled", "true");
    await expect.element(tidy).toHaveAccessibleDescription("Place facets first");
    expect((tidy.element() as HTMLButtonElement).disabled).toBe(false);
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    await tidy.click({ force: true });
    expect(onTidy).not.toHaveBeenCalled();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(button("Fit")).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(tidy).toHaveFocus();
    await userEvent.keyboard("{Home}");
    await expect.element(button("Select")).toHaveFocus();
    await userEvent.keyboard("{End}");
    await expect.element(button("Fit")).toHaveFocus();
  });

  test("horizontal: ← → move and ↑ ↓ don't", async () => {
    await renderWithStudio(<Strip orientation="horizontal" onTidy={vi.fn()} />);
    await button("Select").click();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(button("Hand")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(button("Hand")).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(button("Select")).toHaveFocus();
  });

  test("a tool toggle states it's pressed", async () => {
    await renderWithStudio(<Strip orientation="vertical" onTidy={vi.fn()} />);
    await expect.element(button("Select")).toHaveAttribute("aria-pressed", "true");
    await expect.element(button("Hand")).toHaveAttribute("aria-pressed", "false");
    await button("Hand").click();
    await expect.element(button("Hand")).toHaveAttribute("aria-pressed", "true");
    await expect.element(button("Select")).toHaveAttribute("aria-pressed", "false");
    expect(button("Fit").element().hasAttribute("aria-pressed")).toBe(false);
  });

  test("the label is the name and tooltip, with the shortcut; buttons are at least 24 px", async () => {
    onCleanup(overridePlatform("mac"));
    await renderWithStudio(<Strip orientation="vertical" onTidy={vi.fn()} />);
    expect(button("Zoom out").element().getAttribute("aria-keyshortcuts")).toBe("-");
    settings.set({ singleKeys: false });
    await expect.poll(() => button("Zoom out").element().hasAttribute("aria-keyshortcuts")).toBe(false);
    settings.set({ singleKeys: true });
    await expect.element(button("Zoom out")).toHaveAttribute("aria-keyshortcuts", "-");
    await button("Before").click();
    await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await expect.element(button("Zoom out")).toHaveFocus();
    await expect.element(page.getByText("Zoom out", { exact: true }).last()).toBeVisible();
    const rect = button("Fit").element().getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(24);
    expect(rect.height).toBeGreaterThanOrEqual(24);
  });
});
