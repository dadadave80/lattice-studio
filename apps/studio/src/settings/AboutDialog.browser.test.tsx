import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { runCommand, session } from "@/contracts";
import { Button, DialogHost } from "@/ui";
import { renderWithStudio } from "../../test/harness";

function App() {
  return (
    <>
      <Button onClick={() => void runCommand({ id: "about.open" }, "menu")}>About</Button>
      <DialogHost />
    </>
  );
}

const dialog = () => page.getByRole("dialog", { name: "About" });
const opener = () => page.getByRole("button", { name: "About" });

describe("About dialog (App menu → About, IR L64)", () => {
  test("about.open shows it, and Close returns focus to what opened it", async () => {
    await renderWithStudio(<App />);
    await opener().click();
    await expect.element(dialog()).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
    expect(session.get().dialogs).toEqual([]);
  });

  test("Esc closes it too", async () => {
    await renderWithStudio(<App />);
    await opener().click();
    await expect.element(dialog()).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog()).not.toBeInTheDocument();
  });
});
