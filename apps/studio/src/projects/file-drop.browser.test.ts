import { makeRecipe } from "@lattice-studio/core/testing";
import { expect, test } from "vitest";
import { createProject, doc, setCatalogStatus } from "@/contracts";
import { clearOpenFailure, openFailure } from "@/persist";
import { testPersistence } from "@/persist/testing";
import { bufferedServices, fixtureCatalog, onCleanup } from "../../test/harness";
import { installFileDrop } from "./file-drop";

function drop(file: File): void {
  const target = new EventTarget();
  onCleanup(installFileDrop(target));
  const transfer = new DataTransfer();
  transfer.items.add(file);
  target.dispatchEvent(new DragEvent("drop", { cancelable: true, dataTransfer: transfer }));
  // Native drag data is protected as soon as the event task ends.
  transfer.items.clear();
}

async function ready(): Promise<void> {
  const catalog = fixtureCatalog();
  setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
  testPersistence();
  onCleanup(clearOpenFailure);
  const created = await createProject(makeRecipe({}, catalog), "Before drop");
  if (!created.ok) throw new Error(created.error);
}

test("captures a dropped File before lazy imports outlive its drag data", async () => {
  await ready();
  const before = doc.get().id;
  const text = JSON.stringify({ ...makeRecipe({}, fixtureCatalog()), name: "CapturedVault" });
  drop(new File([text], "captured.json", { type: "application/json" }));
  await expect.poll(() => doc.get().id, { timeout: 10_000 }).not.toBe(before);
  expect(doc.get().name).toBe("CapturedVault");
});

test("reports a dropped file read rejection once with its filename and reason", async () => {
  await ready();
  const before = doc.get();
  const file = new File(["unreadable"], "unreadable.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: () => Promise.reject(new Error("Disk read failed")) });
  drop(file);
  await expect.poll(() => openFailure()?.reason).toBe("unreadable.json: Disk read failed");
  expect(doc.get()).toBe(before);
  expect(bufferedServices().log.filter((line) => line.tag === "Error")).toHaveLength(1);
});
