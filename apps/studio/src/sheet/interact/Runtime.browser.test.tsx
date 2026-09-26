/**
 * The interactions runtime loads after the first paint (`runtime.ts`): a command run before it has loaded (the
 * palette, with the sheet not showing) loads it and still does what it says.
 */
import { expect, test } from "vitest";
import { runCommand, session } from "@/contracts";
import { seedStudio } from "../../../test/harness";
import { loadedRuntime } from "./runtime";
import { sheetProject } from "./testing/interact-harness";

test("a command run before the runtime has loaded loads it and runs", async () => {
  const project = sheetProject(3, { id: "runtime" });
  seedStudio({ project });
  expect(loadedRuntime()).toBeNull();
  const outcome = await runCommand({ id: "sheet.selectAll" }, "palette");
  expect(outcome.ok).toBe(true);
  expect(loadedRuntime()).not.toBeNull();
  expect(session.get().selection).toEqual(project.recipe.facets);
});
