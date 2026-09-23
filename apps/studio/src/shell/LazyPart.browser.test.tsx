import { lazy } from "react";
import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { renderWithStudio } from "../../test/harness";
import { LazyPart, lazyNamed } from "./LazyPart";

function Part() {
  return <p>Loaded part</p>;
}

/** A lazy component whose chunk arrives when the test says so. */
function deferredPart() {
  let arrive: () => void = () => undefined;
  let fail: (reason: Error) => void = () => undefined;
  const chunk = new Promise<{ Part: typeof Part }>((resolve, reject) => {
    arrive = () => resolve({ Part });
    fail = reject;
  });
  return { Lazy: lazyNamed(() => chunk, "Part"), arrive: () => arrive(), fail: (reason: Error) => fail(reason) };
}

describe("LazyPart", () => {
  test("shows the fallback until the part's chunk arrives", async () => {
    const { Lazy, arrive } = deferredPart();
    await renderWithStudio(
      <LazyPart fallback={<p>Waiting</p>}>
        <Lazy />
      </LazyPart>,
    );
    await expect.element(page.getByText("Waiting")).toBeVisible();
    expect(document.body.textContent).not.toContain("Loaded part");
    arrive();
    await expect.element(page.getByText("Loaded part")).toBeVisible();
    expect(document.body.textContent).not.toContain("Waiting");
  });

  test("keeps the fallback, and the rest of the app, when the chunk can't load", async () => {
    const { Lazy, fail } = deferredPart();
    await renderWithStudio(
      <>
        <p>Rest of the app</p>
        <LazyPart fallback={<p>Waiting</p>}>
          <Lazy />
        </LazyPart>
      </>,
    );
    fail(new Error("Failed to fetch dynamically imported module: /assets/Part.js"));
    await expect.poll(() => document.body.textContent).toContain("Rest of the app");
    await expect.element(page.getByText("Waiting")).toBeVisible();
    expect(document.body.textContent).not.toContain("Loaded part");
  });

  test("renders nothing by default while loading", async () => {
    const Never = lazy(() => new Promise<{ default: typeof Part }>(() => undefined));
    const screen = await renderWithStudio(
      <div data-testid="host">
        <LazyPart>
          <Never />
        </LazyPart>
      </div>,
    );
    await expect.element(screen.getByTestId("host")).toBeInTheDocument();
    expect(screen.getByTestId("host").element().childElementCount).toBe(0);
  });
});
