import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { useDraft } from "./use-draft";

function deferred() {
  let resolve: (error: string | null) => void = () => {};
  const promise = new Promise<string | null>((finish) => { resolve = finish; });
  return { promise, resolve };
}

function DraftField({ commitText }: { commitText: (text: string) => Promise<string | null> }) {
  const [stored, setStored] = useState("Stored value");
  const draft = useDraft(stored, async (text) => {
    const error = await commitText(text);
    if (error === null) setStored(text);
    return error;
  });
  return (
    <>
      <label>
        Value
        <input value={draft.text} onChange={(event) => draft.change(event.target.value)} onKeyDown={draft.onKeyDown} onBlur={draft.onBlur} />
      </label>
      <output aria-label="Commit state">{draft.busy ? "Saving" : "Idle"}</output>
      <output aria-label="Stored value">{stored}</output>
      {draft.error ? <p role="alert">{draft.error}</p> : null}
    </>
  );
}

describe("init field drafts while a commit is pending", () => {
  test("an older successful commit preserves newer typing", async () => {
    const older = deferred();
    const commit = vi.fn(() => older.promise);
    await renderWithStudio(<DraftField commitText={commit} />);
    const input = page.getByRole("textbox", { name: "Value" });
    await input.fill("Older value");
    await userEvent.keyboard("{Enter}");
    expect(commit).toHaveBeenCalledWith("Older value");
    await expect.element(page.getByRole("status", { name: "Commit state" })).toHaveTextContent("Saving");

    await input.fill("Newer draft");
    older.resolve(null);
    await expect.element(page.getByRole("status", { name: "Stored value" })).toHaveTextContent("Older value");
    await expect.element(page.getByRole("status", { name: "Commit state" })).toHaveTextContent("Idle");
    await expect.element(input).toHaveValue("Newer draft");
  });

  test("an older failure does not apply an error to newer typing", async () => {
    const older = deferred();
    await renderWithStudio(<DraftField commitText={() => older.promise} />);
    const input = page.getByRole("textbox", { name: "Value" });
    await input.fill("Older value");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("status", { name: "Commit state" })).toHaveTextContent("Saving");

    await input.fill("Newer draft");
    older.resolve("The older value could not be saved.");
    await expect.element(page.getByRole("status", { name: "Commit state" })).toHaveTextContent("Idle");
    await expect.element(input).toHaveValue("Newer draft");
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  });

  test("Escape keeps an older failure from restoring a cleared error", async () => {
    const older = deferred();
    await renderWithStudio(<DraftField commitText={() => older.promise} />);
    const input = page.getByRole("textbox", { name: "Value" });
    await input.fill("Older value");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("status", { name: "Commit state" })).toHaveTextContent("Saving");
    await userEvent.keyboard("{Escape}");
    await expect.element(input).toHaveValue("Stored value");

    older.resolve("The older value could not be saved.");
    await expect.element(page.getByRole("status", { name: "Commit state" })).toHaveTextContent("Idle");
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  });

  test("overlapping commits stay busy and preserve the latest result", async () => {
    const older = deferred();
    const newer = deferred();
    const commit = vi.fn((text: string) => text === "Older value" ? older.promise : newer.promise);
    await renderWithStudio(<DraftField commitText={commit} />);
    const input = page.getByRole("textbox", { name: "Value" });
    await input.fill("Older value");
    await userEvent.keyboard("{Enter}");
    await input.fill("Newer draft");
    await userEvent.keyboard("{Enter}");
    expect(commit).toHaveBeenCalledTimes(2);
    newer.resolve("The newer value could not be saved.");
    try {
      await expect.element(page.getByRole("alert")).toHaveTextContent("The newer value could not be saved.");
      await expect.element(page.getByRole("status", { name: "Commit state" })).toHaveTextContent("Saving");
    } finally {
      older.resolve(null);
    }
    await expect.element(page.getByRole("status", { name: "Commit state" })).toHaveTextContent("Idle");
    await expect.element(input).toHaveValue("Newer draft");
    await expect.element(page.getByRole("alert")).toHaveTextContent("The newer value could not be saved.");
  });
});
