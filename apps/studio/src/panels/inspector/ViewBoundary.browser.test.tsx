import { NotImplemented } from "@lattice-studio/core";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { bufferedServices } from "../../../test/harness";
import { ViewBoundary } from "./ViewBoundary";

let failing = true;

function Flaky() {
  if (failing) throw new Error("boom");
  return <p>Footer is back</p>;
}

function Unbuilt(): never {
  throw new NotImplemented("S8a", "chainService");
}

describe("ViewBoundary", () => {
  test("an error shows its reason and is logged; a new resetKey renders the children again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    failing = true;
    const screen = await render(
      <ViewBoundary resetKey="diamond">
        <Flaky />
      </ViewBoundary>,
    );
    await expect.element(page.getByText("The inspector couldn't show this view: boom")).toBeVisible();
    expect(bufferedServices().log.some((line) => line.text === "The inspector couldn't show this view: boom")).toBe(true);
    failing = false;
    await screen.rerender(
      <ViewBoundary resetKey="diamond">
        <Flaky />
      </ViewBoundary>,
    );
    await expect.element(page.getByText("The inspector couldn't show this view: boom")).toBeVisible();
    await screen.rerender(
      <ViewBoundary resetKey="facet:ERC20">
        <Flaky />
      </ViewBoundary>,
    );
    await expect.element(page.getByText("Footer is back")).toBeVisible();
  });

  test("an unfinished neighbor reads Not built yet", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await render(
      <ViewBoundary>
        <Unbuilt />
      </ViewBoundary>,
    );
    await expect.element(page.getByText("Not built yet · WP-S8a")).toBeVisible();
  });
});
