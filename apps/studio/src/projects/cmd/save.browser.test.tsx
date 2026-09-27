/**
 * Mod+S never falls through to the browser's own Save Page (spec L497, F10-11 #9): `project.save`'s
 * `keyContext` is every context (`[...KEY_CONTEXTS]`), and the dispatcher (`commands/keys/dispatcher.ts`)
 * calls `preventDefault` on a matched binding whether or not the command can currently run, so a text field,
 * an open dialog and a read-only tab all keep the keypress from Studio's JavaScript alone.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { command, session, type Command } from "@/contracts";
import { installShortcuts } from "@/commands/keys/dispatcher";
import { overridePlatform } from "@/ui/shared/platform";
import { onCleanup, overrideCommands, renderWithStudio } from "../../../test/harness";
import { saveCommand } from "./save";

let ran = 0;

/** `project.save`'s own keys and key context, with a stub `run` (the real one touches persistence). */
function fakeSaveCommand(): Command {
  return command({
    id: "project.save",
    title: () => "Save",
    category: "Session",
    keys: saveCommand.keys ?? [],
    keyContext: saveCommand.keyContext ?? [],
    enabled: () => ({ ok: true }),
    run: () => {
      ran += 1;
    },
  });
}

beforeEach(() => {
  ran = 0;
  onCleanup(overridePlatform("mac"));
  onCleanup(installShortcuts());
  overrideCommands([fakeSaveCommand()]);
});

function Surface() {
  return (
    <div>
      <input aria-label="Rename" data-testid="field" />
      <div data-keyctx="dialog" data-testid="dialog">
        <button type="button" data-testid="dialog-button">
          In dialog
        </button>
      </div>
      <div data-keyctx="sheet" data-testid="sheet" />
    </div>
  );
}

const el = (id: string) => page.getByTestId(id).element() as HTMLElement;

/** A Mod+S keydown as the platform's real modifier, fired at `target`. */
function modS(target: HTMLElement): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "s", code: "KeyS", metaKey: true });
  target.dispatchEvent(event);
  return event;
}

describe("Mod+S is always Studio's (spec L497, F10-11 #9)", () => {
  test("a text field: the browser's Save Page never opens", async () => {
    await renderWithStudio(<Surface />);
    const event = modS(el("field"));
    expect(event.defaultPrevented).toBe(true);
    expect(ran).toBe(1);
  });

  test("a dialog open: the shortcut still reaches Studio, not the page behind it", async () => {
    await renderWithStudio(<Surface />);
    const event = modS(el("dialog-button"));
    expect(event.defaultPrevented).toBe(true);
    expect(ran).toBe(1);
  });

  test("a read-only tab: the keypress is still consumed (project.save runs; it says why it can't save elsewhere)", async () => {
    await renderWithStudio(<Surface />);
    session.set({ readOnly: "Another tab is editing this project" });
    onCleanup(() => session.set({ readOnly: null }));
    const event = modS(el("sheet"));
    expect(event.defaultPrevented).toBe(true);
    expect(ran).toBe(1);
  });
});
