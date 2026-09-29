import { beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { log, session, settings, type ThemeChoice } from "@/contracts";
import { axeViolations } from "@/ui/testing/axe";
import { bufferedServices, onCleanup, renderWithStudio } from "../../../test/harness";
import { ConsolePanel } from "./ConsolePanel";
import { startKeepLog } from "./keep-log";
import { flushLogPersistence, LOG_STORAGE_KEY, logEntries, type LogStorage } from "./log-store";
import { EMPTY_LOG, JUMP_TO_LATEST } from "./LogView";
import { awaitConsoleBody, erc20Project, recordLocate, resetConsole } from "./test-support";

beforeEach(() => resetConsole());

const logRegion = () => page.getByRole("log", { name: "Log" });
const filterBox = () => page.getByRole("searchbox", { name: "Filter the log" });
const lineTexts = () => [...logRegion().element().querySelectorAll("[data-line-id]")].map((el) => el.textContent ?? "");
/** A log line by its accessible name (its tag, then its text). */
const line = (name: RegExp) => logRegion().getByRole("button", { name });
/** Waits until the element's text includes `text`. */
async function hasText(locator: { element(): Element }, text: string): Promise<void> {
  await vi.waitFor(() => expect(locator.element().textContent ?? "").toContain(text));
}

async function renderConsole(options: { theme?: "dark" | "light" } = {}) {
  const rendered = await renderWithStudio(<div style={{ height: "400px", display: "flex" }}><ConsolePanel /></div>, {
    project: erc20Project(),
    ...(options.theme ? { theme: options.theme } : {}),
  });
  await awaitConsoleBody();
  return rendered;
}

function seedLines() {
  log({ tag: "Placed", text: "Placed ERC20 · 9 selectors · erc7201:lattice.storage.ERC20", anchor: { kind: "facet", facet: "ERC20" } });
  log({ tag: "Collision", text: "AxelarGatewayAdapter and HyperlaneGatewayAdapter both export `sendMessage · 0xcdfe7f5c`. Choose an owner.", anchor: { kind: "selector", selector: "0xcdfe7f5c", facet: "AxelarGatewayAdapter" } });
  log({ tag: "Note", text: "Tidied 4 facets." });
  log({ tag: "Error", text: "Deploy reverted in LatticeRegistry: `LatticeRegistry__RecordNotFound(lattice.ERC20, 0.4.0)`." });
}

describe("Log (IR L134)", () => {
  test("empty, it says how to start; lines show their tag and text as a role=log", async () => {
    await renderConsole();
    await hasText(logRegion(), EMPTY_LOG);
    seedLines();
    await hasText(logRegion(), "Placed ERC20 · 9 selectors");
    expect(lineTexts()).toHaveLength(4);
    expect(lineTexts()[0]).toMatch(/^Placed/);
    // Code spans render as code, never as markup.
    expect(logRegion().element().querySelector("code")?.textContent).toBe("sendMessage · 0xcdfe7f5c");
  });

  test("tag chips narrow the lines and say Showing x of y", async () => {
    await renderConsole();
    seedLines();
    await userEvent.click(page.getByRole("button", { name: "Collision", exact: true }));
    await userEvent.click(page.getByRole("button", { name: "Error", exact: true }));
    await expect.element(page.getByText("Showing 2 of 4")).toBeVisible();
    expect(lineTexts().map((t) => t.slice(0, 9))).toEqual(["Collision", "ErrorDepl"]);
    await userEvent.click(page.getByRole("button", { name: "Collision", exact: true }));
    await expect.element(page.getByText("Showing 1 of 4")).toBeVisible();
  });

  test("text, -exclude and /regex/ filter; a filter matching nothing says so", async () => {
    await renderConsole();
    seedLines();
    await userEvent.fill(filterBox(), "erc20");
    await expect.element(page.getByText("Showing 2 of 4")).toBeVisible();
    await userEvent.fill(filterBox(), "erc20 -placed");
    await expect.element(page.getByText("Showing 1 of 4")).toBeVisible();
    expect(lineTexts()[0]).toMatch(/^Error/);
    await userEvent.fill(filterBox(), "/^(note|placed) /");
    await expect.element(page.getByText("Showing 2 of 4")).toBeVisible();
    expect(lineTexts().map((t) => t.split(/(?=[A-Z][a-z])/)[0])).toEqual(["Placed", "Note"]);
    await userEvent.fill(filterBox(), "nothing-like-this");
    await hasText(logRegion(), "No lines match the filter.");
    await userEvent.fill(filterBox(), "");
    await expect.element(page.getByText(/Showing/)).not.toBeInTheDocument();
  });

  test("repeats collapse to ×n", async () => {
    await renderConsole();
    for (let i = 0; i < 3; i += 1) log({ tag: "Note", text: "Nothing to close." });
    await hasText(logRegion(), "Nothing to close.×3, 3 times");
    expect(logEntries()).toHaveLength(1);
  });

  test("scrolling up pauses auto-scroll; Jump to latest resumes it", async () => {
    await renderConsole();
    for (let i = 0; i < 40; i += 1) log({ tag: "Note", text: `Line ${i}` });
    const list = logRegion().element() as HTMLElement;
    await vi.waitFor(() => expect(list.scrollHeight - list.scrollTop - list.clientHeight).toBeLessThanOrEqual(4));
    list.scrollTop = 0;
    list.dispatchEvent(new Event("scroll"));
    const jump = page.getByRole("button", { name: JUMP_TO_LATEST });
    await expect.element(jump).toBeVisible();
    log({ tag: "Note", text: "Line 40" });
    await hasText(logRegion(), "Line 40");
    expect(list.scrollTop).toBe(0);
    await userEvent.click(jump);
    await vi.waitFor(() => expect(list.scrollHeight - list.scrollTop - list.clientHeight).toBeLessThanOrEqual(4));
    await expect.element(jump).not.toBeInTheDocument();
    log({ tag: "Note", text: "Line 41" });
    await vi.waitFor(() => expect(list.scrollHeight - list.scrollTop - list.clientHeight).toBeLessThanOrEqual(4));
  });

  test("clicking a line selects and locates its facet or pin; the keyboard does the same", async () => {
    const located = recordLocate();
    await renderConsole();
    seedLines();
    await userEvent.click(line(/^Placed/));
    expect(session.get().selection).toEqual(["ERC20"]);
    expect(located).toEqual([{ facet: "ERC20" }]);
    // One Tab stop; arrows move; Enter locates the pin.
    await expect.element(line(/^Placed/)).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(line(/^Collision/)).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(located.at(-1)).toEqual({ facet: "AxelarGatewayAdapter", selector: "0xcdfe7f5c" });
    expect(session.get().selection).toEqual(["AxelarGatewayAdapter"]);
    await userEvent.keyboard("{End}");
    await expect.element(line(/^Error/)).toHaveFocus();
    // A line with nothing on the sheet selects the line only.
    await userEvent.keyboard("{Enter}");
    expect(located).toHaveLength(2);
    expect(line(/^Error/).element().getAttribute("aria-current")).toBe("true");
  });

  test("Clear empties the log; Copy line and Copy all copy what's selected and shown", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    onCleanup(() => writeText.mockRestore());
    await renderConsole();
    seedLines();
    const copyLine = page.getByRole("button", { name: "Copy line" });
    expect(copyLine.element().getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(line(/^Note/));
    await userEvent.click(copyLine);
    expect(writeText).toHaveBeenLastCalledWith("Tidied 4 facets.");
    expect(bufferedServices().toast.at(-1)).toEqual({ text: "Copied Tidied 4 facets." });
    await userEvent.click(page.getByRole("button", { name: "Log menu" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Copy all" }));
    // Every toast is also a console line (spec L733), so "Copied Tidied 4 facets." joins the four seeded lines.
    await vi.waitFor(() => expect(bufferedServices().toast.at(-1)?.text).toMatch(/^Copied \d+ lines$/));
    const copied = String(writeText.mock.calls.at(-1)?.[0]);
    expect(bufferedServices().toast.at(-1)?.text).toBe(`Copied ${copied.split("\n").length} lines`);
    expect(copied).toMatch(/^Placed\tPlaced ERC20[\s\S]*\nError\tDeploy reverted/);
    await userEvent.click(page.getByRole("button", { name: "Clear the log" }));
    await hasText(logRegion(), EMPTY_LOG);
    expect(bufferedServices().announce.at(-1)?.[0]).toBe("Cleared the log.");
  });

  test("Keep log across reloads follows the setting and brings the log back", async () => {
    const store = new Map<string, string>();
    const storage: LogStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    };
    onCleanup(startKeepLog(storage));
    await renderConsole();
    log({ tag: "Note", text: "Kept line" });
    await userEvent.click(page.getByRole("button", { name: "Log menu" }));
    await userEvent.click(page.getByRole("menuitemcheckbox", { name: "Keep log across reloads" }));
    expect(settings.get().keepLog).toBe(true);
    flushLogPersistence();
    expect(JSON.parse(store.get(LOG_STORAGE_KEY) ?? "[]")).toEqual([expect.objectContaining({ text: "Kept line", tag: "Note" })]);

    // A reload: an empty log, then the kept lines come back first.
    resetConsole();
    log({ tag: "Note", text: "After reload" });
    onCleanup(startKeepLog(storage));
    expect(logEntries().map((e) => e.text)).toEqual(["Kept line", "After reload"]);

    settings.set({ keepLog: false });
    expect(store.has(LOG_STORAGE_KEY)).toBe(false);
  });

  test("the log isn't read twice: role=log with aria-live off; deploy output is announced per the setting", async () => {
    await renderConsole();
    expect(logRegion().element().getAttribute("aria-live")).toBe("off");
    const before = bufferedServices().announce.length;
    const said = () => bufferedServices().announce.slice(before).map(([text, options]) => [text, options?.politeness ?? "polite"]);

    // Default "errors": a revert interrupts; progress stays quiet.
    log({ tag: "Deploy", text: "Submitted 0x1234…abcd on Sepolia." });
    log({ tag: "Error", text: "Deploy reverted in LatticeRegistry: `X()`." });
    expect(said()).toEqual([["Deploy reverted in LatticeRegistry: `X()`.", "assertive"]]);

    settings.set({ deployAnnouncements: "all" });
    log({ tag: "Verify", text: "Verified on Sourcify (exact match)." });
    log({ tag: "Note", text: "Tidied 4 facets." });
    expect(said().at(-1)).toEqual(["Verified on Sourcify (exact match).", "polite"]);
    expect(said()).toHaveLength(2);

    settings.set({ deployAnnouncements: "none" });
    log({ tag: "Error", text: "Deploy reverted again." });
    expect(said()).toHaveLength(2);
  });

  for (const theme of ["dark", "light"] as const satisfies readonly ThemeChoice[]) {
    test(`no axe violations with lines, in ${theme}`, async () => {
      await renderConsole({ theme });
      seedLines();
      await hasText(logRegion(), "Tidied");
      expect(await axeViolations(document.body)).toEqual([]);
    });
  }
});
