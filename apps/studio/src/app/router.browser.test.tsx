import type { Analysis, Problem } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { doc, emptyAnalysis, provideAnalysis, provideServices, session } from "@/contracts";
import { bufferedServices, fixtureCatalog, onCleanup, renderWithStudio } from "../../test/harness";
import { App } from "./App";

function go(hash: string): void {
  history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
}

afterEach(async () => {
  go("");
  await page.viewport(1440, 900);
});

const lastLine = () => bufferedServices().log.at(-1)?.text;

describe("routes", () => {
  test("#/docs/problems/SEL-01 opens the problem's page in the inspector", async () => {
    go("#/docs/problems/SEL-01");
    await renderWithStudio(<App />);
    await expect.poll(() => session.get().panes.inspector.view).toEqual({ kind: "doc", code: "SEL-01" });
    expect(document.getElementById("shell-inspector")?.hidden).toBe(false);
  });

  test("a code that isn't one opens the help index, and says so", async () => {
    go("#/docs/problems/XYZ-99");
    await renderWithStudio(<App />);
    await expect.poll(() => session.get().panes.inspector.view).toEqual({ kind: "doc" });
    expect(bufferedServices().log.some((l) => l.text === `"XYZ-99" isn't a problem code. Showing the help index.`)).toBe(true);
  });

  test("under 768 px, a doc route switches to the Inspector pane", async () => {
    await page.viewport(600, 900);
    go("#/docs");
    await renderWithStudio(<App />);
    await expect.poll(() => session.get().panes.narrow).toBe("inspector");
    await expect.poll(() => document.getElementById("shell-inspector")?.checkVisibility()).toBe(true);
  });

  test("the hash changing applies the new route", async () => {
    await renderWithStudio(<App />);
    location.hash = "#/docs/problems/NET-06";
    await expect.poll(() => session.get().panes.inspector.view).toEqual({ kind: "doc", code: "NET-06" });
  });

  test("a route change keeps the same sheet", async () => {
    await renderWithStudio(<App />);
    const sheet = document.getElementById("shell-sheet")?.firstElementChild;
    expect(sheet).toBeTruthy();
    location.hash = "#/docs/problems/SEL-01";
    await expect.poll(() => session.get().panes.inspector.view).toEqual({ kind: "doc", code: "SEL-01" });
    location.hash = "#/";
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.getElementById("shell-sheet")?.firstElementChild).toBe(sheet);
  });

  test("#/settings runs Settings, which says it isn't built yet", async () => {
    go("#/settings");
    await renderWithStudio(<App />);
    await expect.poll(lastLine).toBe("Not built yet · WP-S10");
  });

  test("a share link goes to openShareLink whole, and stays in the address", async () => {
    const opened: string[] = [];
    onCleanup(provideServices({ openShareLink: (link) => void opened.push(link) }));
    go("#s=1.abc");
    await renderWithStudio(<App />);
    await expect.poll(() => opened).toEqual(["#s=1.abc"]);
    expect(location.hash).toBe("#s=1.abc");
  });

  test("until S13 provides it, the default says a share link can't open yet", async () => {
    go("#s=1.abc");
    await renderWithStudio(<App />);
    await expect.poll(lastLine).toBe("Opening a shared link: Not built yet · WP-S13");
  });

  test("#open= is v2", async () => {
    go("#open=eip155:11155111:0x5FbDB2315678afecb367f032d93F642f64180aa3");
    await renderWithStudio(<App />);
    await expect.poll(lastLine).toBe("Open diamond… arrives in v2.");
  });

  test("an unknown route says there's nothing there", async () => {
    go("#/nowhere");
    await renderWithStudio(<App />);
    await expect.poll(lastLine).toBe("There's no page at /nowhere. Showing the sheet.");
  });

  test("#/__ui shows the primitives gallery in dev", async () => {
    go("#/__ui");
    await renderWithStudio(<App />);
    await expect.element(page.getByRole("region", { name: "Title bar", exact: true })).not.toBeInTheDocument();
    await expect.poll(() => document.querySelectorAll("section, h1, h2").length).toBeGreaterThan(0);
  });
});

function problem(code: Problem["code"], severity: Problem["severity"], id: string): Problem {
  return { id, code, severity, where: [], params: {}, message: "", fixes: [] };
}

describe("document.title", () => {
  test("names the project and its problems, and follows both", async () => {
    let analysis: Analysis = emptyAnalysis();
    const listeners = new Set<() => void>();
    onCleanup(
      provideAnalysis({
        getAnalysis: () => analysis,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => void listeners.delete(listener);
        },
      }),
    );
    await renderWithStudio(<App />, { project: makeProject({ name: "GovernedVault", recipe: makeRecipe({}, fixtureCatalog()) }) });
    await expect.poll(() => document.title).toBe("GovernedVault · No problems · Lattice Studio");

    analysis = {
      ...emptyAnalysis(),
      problems: [
        problem("SEL-01", "blocker", "SEL-01:0xa9059cbb"), problem("SEL-01", "blocker", "SEL-01:0x23b872dd"),
        problem("INIT-05", "warning", "INIT-05"), problem("NET-07", "info", "NET-07"),
      ],
    };
    for (const listener of listeners) listener();
    await expect.poll(() => document.title).toBe("GovernedVault · 2 blockers · 1 warning · Lattice Studio");

    doc.load({ ...doc.get(), name: "Treasury" });
    await expect.poll(() => document.title).toBe("Treasury · 2 blockers · 1 warning · Lattice Studio");
  });
});
