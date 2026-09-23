import type { Layout } from "@lattice-studio/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { announce, type Direction } from "@/contracts";
import { renderWithStudio } from "../../test/harness";
import { MAX_WAIT_MS, QUIET_MS, resetAnnouncer, spoken } from "./announcer";
import { describeMove } from "./positions";
import { RegionFrame } from "./testing/RegionFrame";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  resetAnnouncer();
  vi.useRealTimers();
});

describe("the status region", () => {
  test("is present from load, empty, before anything is said", async () => {
    await renderWithStudio(<RegionFrame />);
    const status = document.querySelectorAll('[role="status"][data-announcer]');
    expect(status).toHaveLength(1);
    expect(status[0]?.getAttribute("aria-live")).toBe("polite");
    expect(status[0]?.getAttribute("aria-atomic")).toBe("true");
    expect(status[0]?.textContent).toBe("");
    expect(document.querySelectorAll('[role="alert"][data-announcer]')).toHaveLength(1);
  });

  test("five nudges merge into one announcement, positions in words", async () => {
    await renderWithStudio(<RegionFrame />);
    let layout: Layout = { ERC20: { x: 208, y: 0, pins: "right" }, ERC4626: { x: 320, y: 0, pins: "right" } };
    const dir: Direction = "right";
    for (let i = 0; i < 5; i++) {
      const at = layout.ERC20;
      if (!at) throw new Error("ERC20 left the layout");
      layout = { ...layout, ERC20: { ...at, x: at.x + 8 } };
      announce(describeMove(["ERC20"], dir, layout), { merge: "nudge" });
      vi.advanceTimersByTime(QUIET_MS / 4);
    }
    expect(spoken().status).toBe("");
    vi.advanceTimersByTime(QUIET_MS);
    expect(spoken().status).toBe("Moved ERC20 right, beside ERC4626");
    await expect.element(page.getByRole("status")).toHaveTextContent("Moved ERC20 right, beside ERC4626");
  });

  test("different messages that arrive together are read as one, in order", async () => {
    await renderWithStudio(<RegionFrame />);
    announce("Removed 2 facets");
    announce("Moved ERC20 right", { merge: "nudge" });
    announce("Tidied 14 facets.");
    announce("Moved ERC20 down", { merge: "nudge" });
    vi.advanceTimersByTime(QUIET_MS);
    expect(spoken().status).toBe("Removed 2 facets. Moved ERC20 down. Tidied 14 facets.");
  });

  test("a held key still speaks: messages that keep coming flush at the latest after the longest wait", async () => {
    await renderWithStudio(<RegionFrame />);
    for (let t = 0; t < MAX_WAIT_MS; t += QUIET_MS / 2) {
      announce(`Moved ERC20 right ${t}`, { merge: "nudge" });
      vi.advanceTimersByTime(QUIET_MS / 2);
    }
    expect(spoken().status).toMatch(/^Moved ERC20 right \d+$/);
  });

  test("the same words said twice are read twice", async () => {
    await renderWithStudio(<RegionFrame />);
    announce("Copied 0x1234…abcd");
    vi.advanceTimersByTime(QUIET_MS);
    const first = document.querySelector('[role="status"][data-announcer] p');
    announce("Copied 0x1234…abcd");
    vi.advanceTimersByTime(QUIET_MS);
    const second = document.querySelector('[role="status"][data-announcer] p');
    expect(second?.textContent).toBe("Copied 0x1234…abcd");
    expect(second).not.toBe(first);
  });

  test("an interrupting failure goes to the alert region at once", async () => {
    await renderWithStudio(<RegionFrame />);
    announce("Moved ERC20 right", { merge: "nudge" });
    announce("Storage is full.", { politeness: "assertive" });
    expect(spoken()).toEqual({ status: "", alert: "Storage is full." });
    vi.advanceTimersByTime(QUIET_MS);
    expect(spoken().status).toBe("Moved ERC20 right");
  });

  test("announcing before any region mounts still creates the live regions", async () => {
    resetAnnouncer();
    announce("Opened GovernedVault");
    vi.advanceTimersByTime(QUIET_MS);
    expect(spoken().status).toBe("Opened GovernedVault");
  });
});
