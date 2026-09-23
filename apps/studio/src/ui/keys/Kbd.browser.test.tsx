import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { command, settings } from "@/contracts";
import { onCleanup, overrideCommands, renderWithStudio } from "../../../test/harness";
import { overridePlatform } from "../shared/platform";
import { Kbd } from "./Kbd";
import { ShortcutChip } from "./ShortcutChip";

function paletteAndTidy() {
  overrideCommands([
    command({ id: "palette.open", title: () => "Open the command palette", category: "Session", keys: ["Mod+k"], enabled: () => ({ ok: true }), run: () => {} }),
    command({ id: "layout.tidy", title: () => "Tidy layout", category: "Sheet", keys: ["t"], enabled: () => ({ ok: true }), run: () => {} }),
    command({ id: "layout.flipPins", title: () => "Flip pins", category: "Sheet", enabled: () => ({ ok: true }), run: () => {} }),
    command({
      id: "region.focus",
      title: () => "Go to a region",
      category: "Session",
      bindings: [{ name: "inspector", keys: ["Mod+Alt+i"], args: { region: "inspector" }, label: "Go to inspector" }],
      enabled: () => ({ ok: true }),
      run: () => {},
    }),
  ]);
}

describe("Kbd", () => {
  test("⌘K on macOS", async () => {
    onCleanup(overridePlatform("mac"));
    await renderWithStudio(<Kbd keys="Mod+k" />);
    await expect.element(page.getByText("⌘K")).toBeVisible();
    expect(document.querySelector("kbd")?.textContent).toBe("⌘K");
  });

  test("Ctrl+K on Windows and Linux; platform-limited specs pick their own", async () => {
    onCleanup(overridePlatform("other"));
    await renderWithStudio(<Kbd keys={[{ keys: "Ctrl+y", platform: "other" }, "Mod+Shift+z"]} />);
    await expect.element(page.getByText("Ctrl+Y")).toBeVisible();
  });
});

describe("ShortcutChip", () => {
  test("shows a command's binding as remapped in Settings", async () => {
    onCleanup(overridePlatform("mac"));
    paletteAndTidy();
    await renderWithStudio(
      <p>
        <ShortcutChip binding="palette.open" /> <ShortcutChip binding="region.focus#inspector" />
      </p>,
    );
    await expect.element(page.getByText("⌘K")).toBeVisible();
    await expect.element(page.getByText("⌥⌘I")).toBeVisible();
    settings.set({ keymap: { "palette.open": ["Mod+p"] } });
    await expect.element(page.getByText("⌘P")).toBeVisible();
  });

  test("hides single-key shortcuts while they're off, and unbound ones", async () => {
    paletteAndTidy();
    await renderWithStudio(
      <p data-testid="chips">
        <ShortcutChip binding="layout.tidy" />
        <ShortcutChip binding="layout.flipPins" />
      </p>,
    );
    await expect.element(page.getByText("T", { exact: true })).toBeVisible();
    settings.set({ singleKeys: false });
    await expect.poll(() => document.querySelectorAll("[data-testid=chips] kbd").length).toBe(0);
  });
});
