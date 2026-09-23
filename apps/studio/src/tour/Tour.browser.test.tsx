import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { bufferedServices } from "@/contracts/services";
import { installShortcuts } from "../commands/keys/dispatcher";
import { onCleanup, renderWithStudio } from "../../test/harness";
import { Tour } from "./Tour";
import { TOUR_STEPS } from "./steps";
import { endTour, resetTour, startTour, tourState } from "./tour-state";

beforeEach(() => {
  onCleanup(installShortcuts());
});

afterEach(() => {
  resetTour();
});

const card = (name?: string) => (name === undefined ? page.getByRole("group") : page.getByRole("group", { name }));
const next = () => page.getByRole("button", { name: "Next" });
const done = () => page.getByRole("button", { name: "Done" });
const back = () => page.getByRole("button", { name: "Back" });
const endBtn = () => page.getByRole("button", { name: "End tour" });

describe("Tour (spec L400, IR L188)", () => {
  test("renders nothing when the tour isn't running", async () => {
    await renderWithStudio(<Tour />);
    await expect.element(card()).not.toBeInTheDocument();
  });

  test("starting the tour shows step 1 of 5 with the first step's title and text", async () => {
    await renderWithStudio(<Tour />);
    startTour();
    await expect.element(card(TOUR_STEPS[0]!.title)).toBeVisible();
    await expect.element(page.getByText("Step 1 of 5")).toBeVisible();
    await expect.element(page.getByText(TOUR_STEPS[0]!.text)).toBeVisible();
    expect(bufferedServices().announce.at(-1)?.[0]).toBe(`${TOUR_STEPS[0]!.title}. ${TOUR_STEPS[0]!.text}`);
  });

  test("Next advances through all five steps, and the last one reads Done", async () => {
    await renderWithStudio(<Tour />);
    startTour();
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) {
      await expect.element(page.getByText(`Step ${i + 1} of 5`)).toBeVisible();
      await expect.element(card(TOUR_STEPS[i]!.title)).toBeVisible();
      await next().click();
      const nextStep = TOUR_STEPS[i + 1]!;
      expect(bufferedServices().announce.at(-1)?.[0]).toBe(`${nextStep.title}. ${nextStep.text}`);
    }
    await expect.element(page.getByText(`Step ${TOUR_STEPS.length} of 5`)).toBeVisible();
    await expect.element(card(TOUR_STEPS.at(-1)!.title)).toBeVisible();
    await expect.element(done()).toBeVisible();
    await expect.element(next()).not.toBeInTheDocument();
  });

  test("Back is absent on the first step and moves back a step otherwise", async () => {
    await renderWithStudio(<Tour />);
    startTour();
    await expect.element(back()).not.toBeInTheDocument();
    await next().click();
    await expect.element(page.getByText("Step 2 of 5")).toBeVisible();
    await back().click();
    await expect.element(page.getByText("Step 1 of 5")).toBeVisible();
    await expect.element(back()).not.toBeInTheDocument();
  });

  test("Done on the last step ends the tour and logs a line", async () => {
    await renderWithStudio(<Tour />);
    startTour();
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) await next().click();
    await done().click();
    expect(tourState().running).toBe(false);
    expect(bufferedServices().log.at(-1)?.text).toBe("Finished the tour.");
  });

  test("End tour hides the card", async () => {
    await renderWithStudio(<Tour />);
    startTour();
    await expect.element(card()).toBeVisible();
    await endBtn().click();
    expect(tourState().running).toBe(false);
    await expect.element(card()).not.toBeInTheDocument();
  });

  test("Escape ends the tour", async () => {
    await renderWithStudio(<Tour />);
    startTour();
    await expect.element(card()).toBeVisible();
    (document.body as HTMLElement).focus();
    await userEvent.keyboard("{Escape}");
    expect(tourState().running).toBe(false);
    await expect.element(card()).not.toBeInTheDocument();
  });

  test("renders centered, without crashing, when the step's target isn't in the DOM", async () => {
    await renderWithStudio(<Tour />);
    startTour();
    await expect.element(card(TOUR_STEPS[0]!.title)).toBeVisible();
  });

  test("renders alongside its target when the target exists", async () => {
    function WithTarget() {
      return (
        <>
          <div data-tour="console" style={{ position: "fixed", top: 400, left: 40, width: 100, height: 20 }} />
          <Tour />
        </>
      );
    }
    await renderWithStudio(<WithTarget />);
    startTour();
    const consoleIndex = TOUR_STEPS.findIndex((s) => s.id === "console");
    for (let i = 0; i < consoleIndex; i++) await next().click();
    await expect.element(card(TOUR_STEPS[consoleIndex]!.title)).toBeVisible();
    await expect.element(page.getByText(TOUR_STEPS[consoleIndex]!.text)).toBeVisible();
  });

  test("resetTour and endTour both leave the tour stopped", async () => {
    await renderWithStudio(<Tour />);
    startTour();
    endTour();
    expect(tourState()).toEqual({ running: false, step: 0 });
  });
});
