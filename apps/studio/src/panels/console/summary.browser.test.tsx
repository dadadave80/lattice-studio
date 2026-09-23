import type { Analysis, Problem } from "@lattice-studio/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { emptyAnalysis, log, provideAnalysis, provideServices, session, type DeployState } from "@/contracts";
import { onCleanup, renderWithStudio, seedDeployState } from "../../../test/harness";
import { ConsolePanel } from "./ConsolePanel";
import { emptyProject, erc20Project, resetConsole } from "./test-support";

beforeEach(() => resetConsole());

const HASH = "0x3f2a000000000000000000000000000000000000000000000000000000a1c4" as const;
const SAFE = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" as const;

function problem(severity: Problem["severity"], n: number): Problem {
  return { id: `P:${severity}${n}`, code: "SEL-01", severity, where: [], params: {}, message: "m", fixes: [] };
}

/** Serves a fixed analysis for this test. */
function analysisWith(problems: Problem[]): void {
  const analysis: Analysis = { ...emptyAnalysis(), recipeHash: HASH, problems };
  onCleanup(provideAnalysis({ getAnalysis: () => analysis, subscribe: () => () => {} }));
}

const summary = () => document.querySelector<HTMLElement>("[data-summary]");

async function expectSummary(text: string, accent: boolean) {
  await vi.waitFor(() => expect(summary()?.textContent).toBe(text));
  expect(summary()?.hasAttribute("data-accent")).toBe(accent);
}

async function renderConsole(project = erc20Project()) {
  await renderWithStudio(<ConsolePanel />, { project });
}

describe("console summary, one state per row of the table (spec L376-L389)", () => {
  test("Empty: Empty sheet", async () => {
    analysisWith([]);
    await renderConsole(emptyProject());
    await expectSummary("Empty sheet", false);
  });

  test("Composing, no problems: No problems", async () => {
    analysisWith([]);
    await renderConsole();
    await expectSummary("No problems", false);
  });

  test("Blockers present: \"2 blockers\" in the accent; warnings alone stay plain", async () => {
    analysisWith([problem("blocker", 1), problem("blocker", 2), problem("warning", 1), problem("info", 1)]);
    await renderConsole();
    await expectSummary("2 blockers · 1 warning", true);
  });

  test("warnings only", async () => {
    analysisWith([problem("warning", 1)]);
    await renderConsole();
    await expectSummary("1 warning", false);
  });

  test("Deploying: the deploy lines stream in", async () => {
    analysisWith([]);
    // A line from an earlier deploy (a kept log, say) never heads this one.
    log({ tag: "Deploy", text: "Deployed at 0x5FbD…0aa3 in block 9,123,460. Matches the sheet." });
    seedDeployState({ phase: "pending", chainId: 11155111, snapshot: HASH } satisfies DeployState);
    await renderConsole();
    await expectSummary("", false);
    expect(summary()?.dataset.summary).toBe("deploying");
    log({ tag: "Deploy", text: "Submitted 0x1234…abcd on Sepolia." });
    await expectSummary("Submitted 0x1234…abcd on Sepolia.", false);
    log({ tag: "Note", text: "Tidied 4 facets." });
    await expectSummary("Submitted 0x1234…abcd on Sepolia.", false);
  });

  test("Proposed: Proposed to Safe 0x71C7…976F on Sepolia", async () => {
    analysisWith([]);
    seedDeployState({ phase: "proposed", safe: SAFE, chainId: 11155111, snapshot: HASH });
    await renderConsole();
    await expectSummary("Proposed to Safe 0x71C7…976F on Sepolia", false);
  });

  test("Live, in the accent", async () => {
    analysisWith([]);
    seedDeployState({ phase: "live", chainId: 11155111, snapshot: HASH });
    await renderConsole();
    await expectSummary("Live", true);
  });

  test("Mismatch: Deployed, but doesn't match the sheet", async () => {
    analysisWith([]);
    seedDeployState({ phase: "mismatch", chainId: 11155111, snapshot: HASH });
    await renderConsole();
    await expectSummary("Deployed, but doesn't match the sheet", true);
  });

  test("Offline: Offline. Composing works; deploy needs a connection.", async () => {
    analysisWith([problem("blocker", 1)]);
    let online = true;
    const listeners = new Set<(on: boolean) => void>();
    onCleanup(provideServices({
      connection: {
        isOnline: () => online,
        subscribe: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
    }));
    await renderConsole();
    await expectSummary("1 blocker", true);
    online = false;
    for (const fn of listeners) fn(false);
    await expectSummary("Offline. Composing works; deploy needs a connection.", false);
  });

  test("Read-only: unchanged", async () => {
    analysisWith([problem("warning", 1)]);
    await renderConsole();
    session.set({ readOnly: "Another tab is editing this project" });
    await expectSummary("1 warning", false);
  });

  test("a deploy outcome for another recipe no longer describes the sheet", async () => {
    analysisWith([problem("blocker", 1)]);
    seedDeployState({ phase: "live", chainId: 11155111, snapshot: `0x${"11".repeat(32)}` });
    await renderConsole();
    await expectSummary("1 blocker", true);
  });
});
