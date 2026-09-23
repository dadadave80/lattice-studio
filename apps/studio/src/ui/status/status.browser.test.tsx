import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command } from "@/contracts";
import { overrideCommands, renderWithStudio } from "../../../test/harness";
import { Banner } from "./Banner";
import { HATCH_FILL, HatchDefs, hatchedClass } from "./Hatch";
import { StatusChip } from "./StatusChip";

describe("StatusChip", () => {
  test("the words carry the state; the dot is decoration", async () => {
    await renderWithStudio(<StatusChip tone="live" text="Live · Sepolia · r1" />);
    await expect.element(page.getByText("Live · Sepolia · r1")).toBeVisible();
    const dot = document.querySelector("[data-tone=live] > span");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
  });

  test("compact shows the dot and one word but keeps the full text readable", async () => {
    await renderWithStudio(<StatusChip tone="attention" text="Modified since r1" compact />);
    await expect.element(page.getByText("Modified", { exact: true })).toBeVisible();
    const chip = document.querySelector("[data-tone=attention]") as HTMLElement;
    expect(chip.textContent).toContain("Modified since r1");
    expect(chip.title).toBe("Modified since r1");
  });
});

describe("Banner", () => {
  test("names its severity with an icon and a word, and runs its commands", async () => {
    const run = vi.fn();
    overrideCommands([
      command({ id: "catalog.migrate", title: () => "Migrate to 0.4.1", category: "Session", enabled: () => ({ ok: true }), run }),
    ]);
    await renderWithStudio(
      <Banner text="This project uses catalog 0.4.0. It's read-only." tone="warning" actions={[{ id: "catalog.migrate" }]} />,
    );
    await expect.element(page.getByRole("img", { name: "Warning" })).toBeInTheDocument();
    await userEvent.tab();
    await expect.element(page.getByRole("button", { name: "Migrate to 0.4.1" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("a disabled action stays focusable with its reason; Close dismisses", async () => {
    const onDismiss = vi.fn();
    overrideCommands([
      command({
        id: "export.foundry",
        title: () => "Export Foundry script",
        category: "Export",
        enabled: () => ({ ok: false, reason: "Resolve 2 blockers to export · F8" }),
        run: () => {},
      }),
    ]);
    await renderWithStudio(
      <Banner text="Resolve 2 blockers to export · F8" tone="error" actions={[{ id: "export.foundry" }]} dismissible onDismiss={onDismiss} />,
    );
    await expect.element(page.getByRole("img", { name: "Error" })).toBeInTheDocument();
    const action = page.getByRole("button", { name: "Export Foundry script" });
    await expect.element(action).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("button", { name: "Close" }).click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("Hatch", () => {
  test("the SVG pattern and the HTML class both hatch", async () => {
    await renderWithStudio(
      <div>
        <HatchDefs />
        <svg width="40" height="20" aria-hidden="true">
          <rect width="40" height="20" fill={HATCH_FILL} />
        </svg>
        <div className={hatchedClass} style={{ width: 40, height: 20 }} data-testid="hatched" />
      </div>,
    );
    expect(document.getElementById("lx-hatch")?.tagName.toLowerCase()).toBe("pattern");
    const bg = getComputedStyle(page.getByTestId("hatched").element()).backgroundImage;
    expect(bg).toContain("repeating-linear-gradient");
  });
});
