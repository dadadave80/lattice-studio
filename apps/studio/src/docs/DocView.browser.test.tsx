import { createElement, Suspense } from "react";
import { beforeEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { inspectorViewComponent, openProblemDoc, session, useSession, type InspectorView } from "@/contracts";
import { renderWithStudio } from "../../test/harness";
import { PROBLEM_DOC_ENTRIES } from "./content";
import { DocView } from "./DocView";
import { markUserInteractedForTest, resetUserInteractionForTest } from "./test-support";

/**
 * Renders whatever `registerInspectorView` has for the session's current view, exactly what S5c's inspector
 * frame will do — proof that `services.ts` wired `DocView` onto the seam, not just that `DocView` itself works.
 */
function InspectorHost() {
  const view = useSession((s) => s.panes.inspector.view);
  if (!view) return <p>Nothing shown</p>;
  const registered = inspectorViewComponent(view.kind);
  if (!registered) return <p>Nothing shown</p>;
  return <Suspense fallback={<p>Loading…</p>}>{createElement(registered, { view: view as never })}</Suspense>;
}

function setInspectorView(view: InspectorView): void {
  session.set((s) => ({ panes: { ...s.panes, inspector: { ...s.panes.inspector, view } } }));
}

// Every test starts from "nothing has happened yet"; a test of interaction-driven focus marks it itself.
beforeEach(() => {
  resetUserInteractionForTest();
});

describe("HelpIndex (help.open with no code)", () => {
  test("lists every family and every problem code", async () => {
    await renderWithStudio(<DocView view={{ kind: "doc" }} />);
    await expect.element(page.getByRole("heading", { name: "Problem docs" })).toBeVisible();
    for (const family of ["Selectors and seams", "Diamond core, dependencies and storage", "Init, authority and links", "Chain readiness"]) {
      await expect.element(page.getByRole("heading", { name: family })).toBeVisible();
    }
    await expect.element(page.getByText("SEL-01")).toBeVisible();
    await expect.element(page.getByText("NET-08")).toBeVisible();
    expect(page.getByRole("button").elements().length).toBe(PROBLEM_DOC_ENTRIES.length);
  });

  test("clicking a code in the index opens its page and moves focus to it", async () => {
    await renderWithStudio(<InspectorHost />);
    setInspectorView({ kind: "doc" });
    await expect.element(page.getByRole("heading", { name: "Problem docs" })).toBeVisible();
    // A real click: the trusted pointer event is what marks the session as interacted-with, before the
    // page it opens ever mounts (DocLink runs help.open, which is what changes the view).
    await page.getByRole("button", { name: /SEL-01/ }).click();
    const docHeading = page.getByRole("heading", { name: "Selector needs an owner" });
    await expect.element(docHeading).toBeVisible();
    await expect.element(docHeading).toHaveFocus();
    expect(document.activeElement).toBe(docHeading.element());
    expect(document.activeElement).not.toBe(document.body);
  });

  test("a click with no prior pointerdown or keydown still moves focus (screen-reader activation)", async () => {
    await renderWithStudio(<InspectorHost />);
    setInspectorView({ kind: "doc" });
    await expect.element(page.getByRole("heading", { name: "Problem docs" })).toBeVisible();
    // NVDA/JAWS browse-mode Enter and VoiceOver's VO+Space often reach the page as a trusted click with
    // neither a pointerdown nor a keydown first; dispatching the click alone reproduces that, unlike
    // Playwright's .click(), which fires a full pointer sequence.
    const link = page.getByRole("button", { name: /SEL-01/ }).element();
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const docHeading = page.getByRole("heading", { name: "Selector needs an owner" });
    await expect.element(docHeading).toBeVisible();
    await expect.element(docHeading).toHaveFocus();
  });
});

describe("ProblemDoc (one code's page)", () => {
  test("shows what it means, why, how to fix and a rendered example, with a source link at the pinned commit", async () => {
    await renderWithStudio(<DocView view={{ kind: "doc", code: "CORE-01" }} />);
    await expect.element(page.getByRole("heading", { name: "Loupe is incomplete" })).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "What it means" })).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Why" })).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "How to fix" })).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Example" })).toBeVisible();
    // The example is rendered through renderProblem, word for word (spec's own example).
    await expect.element(page.getByText("The loupe is incomplete: facets() is missing. Every Lattice diamond needs all four.")).toBeVisible();
    const link = page.getByRole("link", { name: "LatticeFactory" });
    await expect.element(link).toBeVisible();
    // The fixture catalog's pinned commit (fixtures/catalog/fixture/index.json), never a hardcoded one.
    await expect
      .element(link)
      .toHaveAttribute("href", "https://github.com/dadadave80/lattice/blob/6c8db45aa46986af2edb6a0d8fb02a4a92faef01/src/LatticeFactory.sol#L103-L107");
  });

  test("the back control returns to the index through a click, moving focus to its heading", async () => {
    await renderWithStudio(<InspectorHost />);
    // Simulates a session already underway (the click that first opened this page isn't modeled here);
    // this test's own point is the back direction, exercised below with a real click.
    markUserInteractedForTest();
    openProblemDoc("SEL-01");
    const docHeading = page.getByRole("heading", { name: "Selector needs an owner" });
    await expect.element(docHeading).toBeVisible();
    await expect.element(docHeading).toHaveFocus();
    await page.getByRole("button", { name: "Show all problem docs" }).click();
    const indexHeading = page.getByRole("heading", { name: "Problem docs" });
    await expect.element(indexHeading).toBeVisible();
    await expect.element(indexHeading).toHaveFocus();
    expect(document.activeElement).toBe(indexHeading.element());
    expect(document.activeElement).not.toBe(document.body);
  });

  test("every code's page renders without crashing, each with its own heading", async () => {
    for (const entry of PROBLEM_DOC_ENTRIES) {
      await renderWithStudio(<DocView view={{ kind: "doc", code: entry.code }} />);
      await expect.element(page.getByRole("heading", { name: entry.title })).toBeVisible();
    }
  });
});

describe("a view restored on load", () => {
  test("doesn't take focus without a user action, in either shape", async () => {
    // No interaction has happened in this test (beforeEach reset it): both shapes must render, visible,
    // without moving focus to their heading — exactly what a session-restored inspector pane looks like
    // before the user has touched the page.
    await renderWithStudio(<DocView view={{ kind: "doc" }} />);
    const indexHeading = page.getByRole("heading", { name: "Problem docs" });
    await expect.element(indexHeading).toBeVisible();
    expect(document.activeElement).not.toBe(indexHeading.element());
    expect(document.activeElement).toBe(document.body);

    await renderWithStudio(<DocView view={{ kind: "doc", code: "SEL-01" }} />);
    const docHeading = page.getByRole("heading", { name: "Selector needs an owner" });
    await expect.element(docHeading).toBeVisible();
    expect(document.activeElement).not.toBe(docHeading.element());
    expect(document.activeElement).toBe(document.body);
  });
});
