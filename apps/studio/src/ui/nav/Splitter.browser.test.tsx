import { useState } from "react";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { Splitter, type SplitterProps } from "./Splitter";

type HarnessProps = Pick<SplitterProps, "orientation" | "paneSide" | "min" | "max"> & { initial: number; label: string };

function Harness({ orientation, paneSide, min, max, initial, label }: HarnessProps) {
  const [value, setValue] = useState(initial);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: orientation === "vertical" ? "row" : "column", width: 800, height: 400 }}>
      <div id="pane" style={{ flex: "none", [orientation === "vertical" ? "width" : "height"]: collapsed ? 0 : value }} />
      <Splitter
        label={label}
        controls="pane"
        orientation={orientation}
        paneSide={paneSide}
        value={value}
        min={min}
        max={max}
        onChange={setValue}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
      />
      <div style={{ flex: 1 }} />
    </div>
  );
}

const separator = (name: string) => page.getByRole("separator", { name });

describe("Splitter", () => {
  test("names the pane it resizes and reports its size", async () => {
    await renderWithStudio(<Harness label="Resize left pane" orientation="vertical" paneSide="before" min={200} max={360} initial={240} />);
    const el = separator("Resize left pane");
    await expect.element(el).toHaveAttribute("aria-controls", "pane");
    await expect.element(el).toHaveAttribute("aria-orientation", "vertical");
    await expect.element(el).toHaveAttribute("aria-valuenow", "240");
    await expect.element(el).toHaveAttribute("aria-valuemin", "200");
    await expect.element(el).toHaveAttribute("aria-valuemax", "360");
    const rect = el.element().getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(24);
    expect(rect.height).toBeGreaterThanOrEqual(24);
  });

  test("arrows step 8 px, Shift steps 32, Home and End go to the bounds, and it clamps", async () => {
    await renderWithStudio(<Harness label="Resize left pane" orientation="vertical" paneSide="before" min={200} max={360} initial={240} />);
    const el = separator("Resize left pane");
    await userEvent.tab();
    await expect.element(el).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(el).toHaveAttribute("aria-valuenow", "248");
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await expect.element(el).toHaveAttribute("aria-valuenow", "280");
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(el).toHaveAttribute("aria-valuenow", "272");
    await userEvent.keyboard("{End}");
    await expect.element(el).toHaveAttribute("aria-valuenow", "360");
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(el).toHaveAttribute("aria-valuenow", "360");
    await userEvent.keyboard("{Home}");
    await expect.element(el).toHaveAttribute("aria-valuenow", "200");
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    await expect.element(el).toHaveAttribute("aria-valuenow", "200");
    expect((document.getElementById("pane") as HTMLElement).getBoundingClientRect().width).toBe(200);
  });

  test("a pane after the splitter grows with ← and a horizontal splitter takes ↑ ↓", async () => {
    await renderWithStudio(
      <>
        <Harness label="Resize inspector" orientation="vertical" paneSide="after" min={280} max={420} initial={316} />
        <Harness label="Resize console" orientation="horizontal" paneSide="after" min={36} max={200} initial={124} />
      </>,
    );
    const inspector = separator("Resize inspector");
    await inspector.click();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(inspector).toHaveAttribute("aria-valuenow", "324");
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    await expect.element(inspector).toHaveAttribute("aria-valuenow", "308");

    const drawer = separator("Resize console");
    await drawer.click();
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(drawer).toHaveAttribute("aria-valuenow", "132");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await expect.element(drawer).toHaveAttribute("aria-valuenow", "116");
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(drawer).toHaveAttribute("aria-valuenow", "116");
  });

  test("Enter collapses and restores the pane", async () => {
    await renderWithStudio(<Harness label="Resize left pane" orientation="vertical" paneSide="before" min={200} max={360} initial={248} />);
    const el = separator("Resize left pane");
    await el.click();
    await userEvent.keyboard("{Enter}");
    await expect.element(el).toHaveAttribute("aria-valuetext", "Collapsed");
    expect((document.getElementById("pane") as HTMLElement).getBoundingClientRect().width).toBe(0);
    await userEvent.keyboard("{Enter}");
    expect(el.element().hasAttribute("aria-valuetext")).toBe(false);
    await expect.element(el).toHaveAttribute("aria-valuenow", "248");
    await userEvent.keyboard("{Enter}{ArrowRight}");
    expect(el.element().hasAttribute("aria-valuetext")).toBe(false);
    await expect.element(el).toHaveAttribute("aria-valuenow", "256");
  });

  test("a pointer drag resizes, clamped", async () => {
    await renderWithStudio(<Harness label="Resize left pane" orientation="vertical" paneSide="before" min={200} max={360} initial={240} />);
    const el = separator("Resize left pane").element() as HTMLElement;
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const fire = (type: string, clientX: number) =>
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, button: 0, isPrimary: true, clientX, clientY: y }));
    fire("pointerdown", x);
    fire("pointermove", x + 40);
    await expect.element(separator("Resize left pane")).toHaveAttribute("aria-valuenow", "280");
    fire("pointermove", x + 400);
    await expect.element(separator("Resize left pane")).toHaveAttribute("aria-valuenow", "360");
    fire("pointerup", x + 400);
    fire("pointermove", x);
    await expect.element(separator("Resize left pane")).toHaveAttribute("aria-valuenow", "360");
    expect(document.activeElement).toBe(el);
  });
});
