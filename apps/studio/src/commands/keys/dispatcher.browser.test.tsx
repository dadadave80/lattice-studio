import type { CommandId } from "@lattice-studio/core";
import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command, pushEscape, session, settings, type Command, type KeyContext, type KeySpec } from "@/contracts";
import { bufferedServices } from "@/contracts/services";
import { Button, CommandButton, Menu, MenuItem } from "@/ui";
import { overridePlatform } from "@/ui/shared/platform";
import { onCleanup, overrideCommands, renderWithStudio } from "../../../test/harness";
import { handleKeyDown, installShortcuts } from "./dispatcher";
import { remapBinding } from "./keymap";

const ran: string[] = [];

function fake(id: CommandId, keys: KeySpec[], keyContext: KeyContext[], reason?: string): Command {
  return command({
    id,
    title: () => id,
    category: "Sheet",
    keys,
    keyContext,
    enabled: () => (reason ? { ok: false, reason } : { ok: true }),
    run: () => void ran.push(id),
  });
}

const SHEET: KeyContext[] = ["sheet"];
const EVERYWHERE_BUT_TEXT: KeyContext[] = ["global", "sheet", "card-rows", "tree", "list", "menu", "dialog"];

beforeEach(() => {
  ran.length = 0;
  onCleanup(overridePlatform("mac"));
  onCleanup(installShortcuts());
  overrideCommands([
    fake("layout.tidy", ["t"], SHEET),
    fake("sheet.zoomIn", ["=", "+"], SHEET),
    fake("sheet.zoom100", ["Shift+[Digit0]"], SHEET),
    fake("sheet.zoomFit", ["Shift+[Digit1]"], SHEET),
    fake("history.undo", ["Mod+z"], EVERYWHERE_BUT_TEXT),
    fake("history.redo", ["Mod+Shift+z"], EVERYWHERE_BUT_TEXT),
    fake("tool.hand", ["h"], SHEET, "Nothing to pan"),
    fake("catalog.focusSearch", ["/"], ["global", "sheet", "card-rows"]),
  ]);
});

function Surface() {
  return (
    <div>
      <div data-keyctx="sheet" data-testid="sheet">
        <div data-keyctx="card-rows" data-testid="rows" />
      </div>
      <div data-keyctx="tree" data-testid="tree" />
      <div data-keyctx="list" data-testid="list" />
      <div data-keyctx="menu" data-testid="menu" />
      <div data-keyctx="palette" data-testid="palette" />
      <div data-keyctx="console" data-testid="console">
        <input aria-label="Command" data-keyctx="text" data-testid="command-line" />
      </div>
      <div data-keyctx="sheet">
        <input aria-label="Rename" data-testid="field" />
        <input type="checkbox" aria-label="Pick" data-testid="checkbox" />
      </div>
      <button type="button" data-testid="plain">
        Plain
      </button>
    </div>
  );
}

const el = (id: string) => page.getByTestId(id).element() as HTMLElement;

/** A keydown as a layout produces it, fired at `target` like the browser would. */
function key(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("layouts (spec L754)", () => {
  test("QWERTY: t tidies on the sheet; ⌘Z undoes; ⇧⌘Z redoes", async () => {
    await renderWithStudio(<Surface />);
    key(el("sheet"), { key: "t", code: "KeyT" });
    key(el("sheet"), { key: "z", code: "KeyZ", metaKey: true });
    key(el("sheet"), { key: "z", code: "KeyZ", metaKey: true, shiftKey: true });
    expect(ran).toEqual(["layout.tidy", "history.undo", "history.redo"]);
  });

  test("QWERTZ: ⇧0 types = but zooms to 100%; ⌘Z follows the Z label at KeyY; + is its own key", async () => {
    await renderWithStudio(<Surface />);
    const shift0 = key(el("sheet"), { key: "=", code: "Digit0", shiftKey: true });
    expect(shift0.defaultPrevented).toBe(true);
    key(el("sheet"), { key: "z", code: "KeyY", metaKey: true });
    key(el("sheet"), { key: "+", code: "BracketRight" });
    expect(ran).toEqual(["sheet.zoom100", "history.undo", "sheet.zoomIn"]);
  });

  test("AZERTY: ⇧1 types 1 and fits; the unshifted & does nothing; A at KeyQ is not Q", async () => {
    await renderWithStudio(<Surface />);
    key(el("sheet"), { key: "1", code: "Digit1", shiftKey: true });
    const amp = key(el("sheet"), { key: "&", code: "Digit1" });
    expect(amp.defaultPrevented).toBe(false);
    key(el("sheet"), { key: "z", code: "KeyW", metaKey: true });
    expect(ran).toEqual(["sheet.zoomFit", "history.undo"]);
  });

  test("Cyrillic: letters fall back to their position", async () => {
    await renderWithStudio(<Surface />);
    key(el("sheet"), { key: "е", code: "KeyT" });
    key(el("sheet"), { key: "я", code: "KeyZ", metaKey: true });
    expect(ran).toEqual(["layout.tidy", "history.undo"]);
  });

  test("zoom in on =, + and keypad +", async () => {
    await renderWithStudio(<Surface />);
    key(el("sheet"), { key: "=", code: "Equal" });
    key(el("sheet"), { key: "+", code: "Equal", shiftKey: true });
    key(el("sheet"), { key: "+", code: "NumpadAdd" });
    expect(ran).toEqual(["sheet.zoomIn", "sheet.zoomIn", "sheet.zoomIn"]);
  });
});

describe("inert contexts (spec L753)", () => {
  test("single keys never fire while typing or in trees, lists, menus, the console or the palette", async () => {
    await renderWithStudio(<Surface />);
    for (const id of ["field", "command-line", "tree", "list", "menu", "console", "palette"]) {
      const event = key(el(id), { key: "/", code: "Slash" });
      expect(event.defaultPrevented, id).toBe(false);
    }
    expect(ran).toEqual([]);
    // The same key where single keys are live.
    key(el("sheet"), { key: "/", code: "Slash" });
    key(el("plain"), { key: "/", code: "Slash" });
    key(el("rows"), { key: "/", code: "Slash" });
    expect(ran).toEqual(["catalog.focusSearch", "catalog.focusSearch", "catalog.focusSearch"]);
  });

  test("a text field keeps ⌘Z for native undo; a checkbox is not typing", async () => {
    await renderWithStudio(<Surface />);
    const inField = key(el("field"), { key: "z", code: "KeyZ", metaKey: true });
    expect(inField.defaultPrevented).toBe(false);
    key(el("command-line"), { key: "z", code: "KeyZ", metaKey: true });
    key(el("checkbox"), { key: "t", code: "KeyT" });
    key(el("tree"), { key: "z", code: "KeyZ", metaKey: true });
    expect(ran).toEqual(["layout.tidy", "history.undo"]);
  });

  test("with single keys off, none fire; modified shortcuts still do", async () => {
    await renderWithStudio(<Surface />, { settings: { singleKeys: false } });
    const t = key(el("sheet"), { key: "t", code: "KeyT" });
    expect(t.defaultPrevented).toBe(false);
    key(el("sheet"), { key: "z", code: "KeyZ", metaKey: true });
    expect(ran).toEqual(["history.undo"]);
  });

  test("a key another control already handled is left alone", async () => {
    await renderWithStudio(<Surface />);
    const own = (event: KeyboardEvent) => event.preventDefault();
    el("rows").addEventListener("keydown", own);
    onCleanup(() => el("rows").removeEventListener("keydown", own));
    key(el("rows"), { key: "/", code: "Slash" });
    expect(ran).toEqual([]);
    key(el("sheet"), { key: "/", code: "Slash" });
    expect(ran).toEqual(["catalog.focusSearch"]);
  });
});

describe("interactive controls inside the sheet (FX13 item c)", () => {
  test("Enter, Space, arrows, Home and End go to a tool-strip button, not the sheet's bindings", async () => {
    overrideCommands([
      fake("layout.tidy", ["t"], SHEET),
      fake("sheet.enterRows", ["Enter"], SHEET),
      fake("sheet.nudge", ["ArrowLeft"], SHEET),
      fake("sheet.focusFirst", ["Home"], SHEET),
    ]);
    await renderWithStudio(
      <div data-keyctx="sheet" data-testid="sheet">
        <button type="button" data-testid="tool">
          Hand tool
        </button>
      </div>,
    );
    for (const init of [
      { key: "Enter", code: "Enter" },
      { key: " ", code: "Space" },
      { key: "ArrowLeft", code: "ArrowLeft" },
      { key: "Home", code: "Home" },
      { key: "End", code: "End" },
    ]) {
      const event = key(el("tool"), init);
      expect(event.defaultPrevented, init.key).toBe(false);
    }
    expect(ran).toEqual([]);
    // A key that isn't exempted still reaches the sheet's own binding.
    key(el("tool"), { key: "t", code: "KeyT" });
    expect(ran).toEqual(["layout.tidy"]);
    // The same keys still work on the sheet itself.
    key(el("sheet"), { key: "Enter", code: "Enter" });
    expect(ran).toEqual(["layout.tidy", "sheet.enterRows"]);
  });

  test("a control that declares its own context isn't exempted", async () => {
    overrideCommands([fake("sheet.enterRows", ["Enter"], SHEET)]);
    await renderWithStudio(
      <div data-keyctx="sheet" data-testid="sheet">
        <button type="button" data-keyctx="sheet" data-testid="own">
          Own context
        </button>
      </div>,
    );
    key(el("own"), { key: "Enter", code: "Enter" });
    expect(ran).toEqual(["sheet.enterRows"]);
  });
});

describe("repeat: single keys and Escape don't repeat-fire; zoom and arrows do (IR L23, FX13 item e)", () => {
  test("a held single key doesn't repeat Tidy; releasing and pressing again does", async () => {
    await renderWithStudio(<Surface />);
    const repeated = key(el("sheet"), { key: "t", code: "KeyT", repeat: true });
    expect(repeated.defaultPrevented).toBe(false);
    expect(ran).toEqual([]);
    key(el("sheet"), { key: "t", code: "KeyT" });
    expect(ran).toEqual(["layout.tidy"]);
  });

  test("a held Escape doesn't repeat-fire the Esc stack", async () => {
    await renderWithStudio(<Surface />, { session: { selection: ["ERC20"] } });
    const repeated = key(el("sheet"), { key: "Escape", code: "Escape", repeat: true });
    expect(repeated.defaultPrevented).toBe(false);
    expect(session.get().selection).toEqual(["ERC20"]);
    const esc = key(el("sheet"), { key: "Escape", code: "Escape" });
    expect(esc.defaultPrevented).toBe(true);
    expect(session.get().selection).toEqual([]);
  });

  test("holding + keeps zooming in", async () => {
    overrideCommands([fake("sheet.zoomIn", ["="], SHEET)]);
    await renderWithStudio(<Surface />);
    key(el("sheet"), { key: "=", code: "Equal", repeat: true });
    key(el("sheet"), { key: "=", code: "Equal", repeat: true });
    expect(ran).toEqual(["sheet.zoomIn", "sheet.zoomIn"]);
  });

  test("holding an arrow keeps nudging", async () => {
    overrideCommands([fake("sheet.nudge", ["ArrowLeft"], SHEET)]);
    await renderWithStudio(<Surface />);
    key(el("sheet"), { key: "ArrowLeft", code: "ArrowLeft", repeat: true });
    key(el("sheet"), { key: "ArrowLeft", code: "ArrowLeft", repeat: true });
    expect(ran).toEqual(["sheet.nudge", "sheet.nudge"]);
  });
});

describe("what the dispatcher consumes", () => {
  test("a disabled command's key is consumed and says why", async () => {
    await renderWithStudio(<Surface />);
    const h = key(el("sheet"), { key: "h", code: "KeyH" });
    expect(h.defaultPrevented).toBe(true);
    expect(ran).toEqual([]);
    await expect.poll(() => bufferedServices().log.at(-1)?.text).toBe("Nothing to pan");
  });

  test("⌘+arrow is consumed on the sheet even with nothing bound; the browser keeps ⌘ + − 0, ⌘F and ⌘L", async () => {
    await renderWithStudio(<Surface />);
    expect(key(el("sheet"), { key: "ArrowLeft", code: "ArrowLeft", metaKey: true }).defaultPrevented).toBe(true);
    expect(key(el("plain"), { key: "ArrowLeft", code: "ArrowLeft", metaKey: true }).defaultPrevented).toBe(false);
    overrideCommands([fake("sheet.zoomIn", ["Mod+="], SHEET), fake("console.find", ["Mod+f"], SHEET)]);
    for (const init of [
      { key: "=", code: "Equal", metaKey: true },
      { key: "-", code: "Minus", metaKey: true },
      { key: "0", code: "Digit0", metaKey: true },
      { key: "f", code: "KeyF", metaKey: true },
      { key: "l", code: "KeyL", metaKey: true },
    ]) {
      expect(key(el("sheet"), init).defaultPrevented, init.key).toBe(false);
    }
    expect(ran).toEqual([]);
  });

  test("F6 stays S9's", async () => {
    await renderWithStudio(<Surface />);
    expect(handleKeyDown(new KeyboardEvent("keydown", { key: "F6", code: "F6" }), "mac")).toBeNull();
  });
});

describe("Esc (IR L17)", () => {
  test("the top overlay, then a mode, then a card's rows, then the selection; then Esc passes on", async () => {
    await renderWithStudio(<Surface />, {
      session: { selection: ["ERC20"], modes: { moveTo: false, initOrder: true, rows: "ERC20" } },
    });
    let overlay = true;
    onCleanup(
      pushEscape(() => {
        if (!overlay) return false;
        overlay = false;
      }),
    );
    const esc = () => key(el("sheet"), { key: "Escape", code: "Escape" });
    expect(esc().defaultPrevented).toBe(true);
    expect(overlay).toBe(false);
    expect(session.get().modes.initOrder).toBe(true);
    esc();
    expect(session.get().modes.initOrder).toBe(false);
    esc();
    expect(session.get().modes.rows).toBeNull();
    expect(session.get().selection).toEqual(["ERC20"]);
    esc();
    expect(session.get().selection).toEqual([]);
    expect(esc().defaultPrevented).toBe(false);
  });

  test("a Base UI menu closes itself on Esc and the selection stays", async () => {
    await renderWithStudio(
      <Menu trigger={<Button>Export</Button>} label="Export">
        <MenuItem label="Foundry script" onSelect={() => {}} />
      </Menu>,
      { session: { selection: ["ERC20"] } },
    );
    await page.getByRole("button", { name: "Export" }).click();
    await expect.element(page.getByRole("menu", { name: "Export" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("menu", { name: "Export" })).not.toBeInTheDocument();
    expect(session.get().selection).toEqual(["ERC20"]);
  });

  test("while a dialog is open the stack never runs", async () => {
    await renderWithStudio(<Surface />, { session: { selection: ["ERC20"] } });
    session.set({ dialogs: [{ id: "settings", props: {}, key: 1 }] });
    const event = key(el("sheet"), { key: "Escape", code: "Escape" });
    expect(event.defaultPrevented).toBe(false);
    expect(session.get().selection).toEqual(["ERC20"]);
  });
});

describe("remapping", () => {
  test("a remapped key runs the command, the old one doesn't, and aria-keyshortcuts follows", async () => {
    overrideCommands([
      command({ id: "tool.hand", title: () => "Hand tool", category: "Sheet", keys: ["h"], keyContext: SHEET, enabled: () => ({ ok: true }), run: () => void ran.push("tool.hand") }),
    ]);
    await renderWithStudio(
      <div data-keyctx="sheet" data-testid="sheet">
        <CommandButton command={{ id: "tool.hand" }} />
      </div>,
    );
    const button = page.getByRole("button", { name: "Hand tool" });
    await expect.element(button).toHaveAttribute("aria-keyshortcuts", "H");
    expect(remapBinding("tool.hand", ["g"], { platform: "mac" }).ok).toBe(true);
    await expect.element(button).toHaveAttribute("aria-keyshortcuts", "G");
    key(el("sheet"), { key: "h", code: "KeyH" });
    key(el("sheet"), { key: "g", code: "KeyG" });
    expect(ran).toEqual(["tool.hand"]);
    settings.set({ singleKeys: false });
    await expect.element(button).not.toHaveAttribute("aria-keyshortcuts");
  });
});
