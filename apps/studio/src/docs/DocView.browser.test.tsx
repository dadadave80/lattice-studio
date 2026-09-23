import { createElement, Suspense } from "react";
import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import {
  commandRef, inspectorViewComponent, openProblemDoc, runCommand, session, useSession, type InspectorView,
} from "@/contracts";
import { renderWithStudio } from "../../test/harness";
import { PROBLEM_DOC_ENTRIES } from "./content";
import { DocView } from "./DocView";

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

  test("opening a code from the index runs help.open and shows its page", async () => {
    await renderWithStudio(<InspectorHost />);
    session.set((s) => ({ panes: { ...s.panes, inspector: { ...s.panes.inspector, view: { kind: "doc" } as InspectorView } } }));
    await expect.element(page.getByRole("heading", { name: "Problem docs" })).toBeVisible();
    await runCommand(commandRef("help.open", { code: "SEL-01" }), "button");
    await expect.element(page.getByRole("heading", { name: "Selector needs an owner" })).toBeVisible();
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
      .toHaveAttribute("href", "https://github.com/dadadave80/lattice/blob/f4a32c8330934d39bcfdffff87d35a04b7fa6a79/src/LatticeFactory.sol#L103-L107");
  });

  test("the back control returns to the index through help.open", async () => {
    await renderWithStudio(<InspectorHost />);
    openProblemDoc("SEL-01");
    await expect.element(page.getByRole("heading", { name: "Selector needs an owner" })).toBeVisible();
    await page.getByRole("button", { name: "Back to problem docs" }).click();
    await expect.element(page.getByRole("heading", { name: "Problem docs" })).toBeVisible();
  });

  test("every code's page renders without crashing, each with its own heading", async () => {
    for (const entry of PROBLEM_DOC_ENTRIES) {
      await renderWithStudio(<DocView view={{ kind: "doc", code: entry.code }} />);
      await expect.element(page.getByRole("heading", { name: entry.title })).toBeVisible();
    }
  });
});
