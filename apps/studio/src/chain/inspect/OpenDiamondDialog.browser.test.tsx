import { makeRecipe } from "@lattice-studio/core/testing";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createProject, doc, provideServices, session, type ChainInfo } from "@/contracts";
import { testPersistence } from "@/persist/testing";
import { Button } from "@/ui";
import { axeViolations } from "@/ui/testing/axe";
import { bufferedServices, fixtureCatalog, onCleanup, renderWithStudio } from "../../../test/harness";
import { OpenDiamondDialog, type OpenDiamondDialogProps } from "./OpenDiamondDialog";

const ADDRESS = "0x00000000000000000000000000000000000000aa";
const CHAINS: readonly ChainInfo[] = [
  { id: 11155111, name: "Sepolia", testnet: true },
  { id: 84532, name: "Base Sepolia", testnet: true },
];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  await page.viewport(1440, 900);
});

async function open(options: Partial<Omit<OpenDiamondDialogProps, "onClose">> = {}) {
  const onInspect = options.onInspect ?? vi.fn<OpenDiamondDialogProps["onInspect"]>(async () => ({ ok: true as const, value: undefined }));
  const onClose = vi.fn();
  function Harness() {
    const [show, setShow] = useState(false);
    return <>
      <Button onClick={() => setShow(true)}>Open diamond</Button>
      {show ? <OpenDiamondDialog chains={CHAINS} initialChainId={11155111} {...options} onInspect={onInspect} onClose={() => {
        onClose();
        setShow(false);
      }} /> : null}
    </>;
  }
  await renderWithStudio(<Harness />);
  await page.getByRole("button", { name: "Open diamond", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Open", exact: true });
  await expect.element(dialog).toBeVisible();
  return { dialog, onInspect, onClose };
}

test("labels and focuses the target; Enter inspects without editing the current recipe", async () => {
  const { dialog, onInspect, onClose } = await open();
  const before = doc.get();
  const input = dialog.getByRole("textbox", { name: "Address, name or link" });
  await expect.element(input).toHaveFocus();
  await input.fill(ADDRESS);
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => onClose.mock.calls.length).toBe(1);
  expect(onInspect).toHaveBeenCalledWith({ chainId: 11155111, target: ADDRESS }, expect.any(AbortSignal));
  expect(doc.get()).toBe(before);
  await expect.element(page.getByRole("button", { name: "Open diamond", exact: true })).toHaveFocus();
});

test("asks for a selected chain when the target has none", async () => {
  const onInspect = vi.fn<OpenDiamondDialogProps["onInspect"]>(async () => ({ ok: true as const, value: undefined }));
  const { dialog } = await open({ initialChainId: null, initialTarget: "alice.eth", onInspect });
  await dialog.getByRole("button", { name: "Inspect diamond" }).click();
  expect(onInspect).not.toHaveBeenCalled();
  await expect.element(dialog.getByRole("textbox")).toHaveAccessibleDescription(/Choose a chain/);
  await dialog.getByRole("combobox", { name: "Chain" }).click();
  await page.getByRole("option", { name: "Base Sepolia", exact: true }).click();
  await dialog.getByRole("button", { name: "Inspect diamond" }).click();
  await expect.poll(() => onInspect.mock.calls.length).toBe(1);
  expect(onInspect.mock.calls[0]?.[0]).toEqual({ chainId: 84532, target: "alice.eth" });
});

test("the embedded chain wins and is visible before inspection", async () => {
  const onInspect = vi.fn<OpenDiamondDialogProps["onInspect"]>(async () => ({ ok: true as const, value: undefined }));
  const { dialog } = await open({ initialTarget: `#d=84532:${ADDRESS}`, onInspect });
  await expect.element(dialog.getByRole("combobox", { name: "Chain" }).getByText("Base Sepolia", { exact: true })).toBeVisible();
  await expect.element(dialog.getByRole("combobox", { name: "Chain" })).toHaveAttribute("aria-disabled", "true");
  await dialog.getByRole("button", { name: "Inspect diamond" }).click();
  await expect.poll(() => onInspect.mock.calls.length).toBe(1);
  expect(onInspect.mock.calls[0]?.[0]).toEqual({ chainId: 84532, target: ADDRESS });
});

test("unsupported chains fail before calling the inspection engine", async () => {
  const onInspect = vi.fn<OpenDiamondDialogProps["onInspect"]>(async () => ({ ok: true as const, value: undefined }));
  const { dialog } = await open({ initialTarget: `#d=1:${ADDRESS}`, onInspect });
  await dialog.getByRole("button", { name: "Inspect diamond" }).click();
  await expect.element(dialog.getByText("Studio doesn't support chain 1 yet.", { exact: true })).toBeVisible();
  expect(onInspect).not.toHaveBeenCalled();
});

test("inspection failure stays visible and can be retried", async () => {
  const onInspect = vi.fn<OpenDiamondDialogProps["onInspect"]>()
    .mockResolvedValueOnce({ ok: false, error: "Sepolia's public RPC isn't answering." })
    .mockResolvedValueOnce({ ok: true, value: undefined });
  const { dialog, onClose } = await open({ initialTarget: ADDRESS, onInspect });
  await dialog.getByRole("button", { name: "Inspect diamond" }).click();
  await expect.element(dialog.getByRole("textbox")).toHaveAccessibleDescription(/public RPC isn't answering/);
  expect(onClose).not.toHaveBeenCalled();
  await dialog.getByRole("button", { name: "Inspect diamond" }).click();
  await expect.poll(() => onClose.mock.calls.length).toBe(1);
});

test("an unexpected inspection rejection leaves a usable form without exposing service details", async () => {
  const onInspect = vi.fn<OpenDiamondDialogProps["onInspect"]>().mockRejectedValue(new Error("https://rpc.example/?key=secret"));
  const { dialog, onClose } = await open({ initialTarget: ADDRESS, onInspect });
  await dialog.getByRole("button", { name: "Inspect diamond" }).click();
  await expect.element(dialog.getByText("This diamond couldn't be inspected. Try again.", { exact: true })).toBeVisible();
  expect(dialog.element().textContent).not.toContain("secret");
  await expect.element(dialog.getByRole("button", { name: "Inspect diamond" })).not.toHaveAttribute("aria-disabled");
  expect(onClose).not.toHaveBeenCalled();
});

test("editing aborts inspection and ignores its late failure", async () => {
  let finish: (result: { ok: false; error: string }) => void = () => {};
  const pending = new Promise<{ ok: false; error: string }>((resolve) => { finish = resolve; });
  const onInspect = vi.fn<OpenDiamondDialogProps["onInspect"]>(() => pending);
  const { dialog, onClose } = await open({ initialTarget: ADDRESS, onInspect });
  await dialog.getByRole("button", { name: "Inspect diamond" }).click();
  await expect.element(dialog.getByRole("status")).toHaveTextContent("Inspecting diamond…");
  const signal = onInspect.mock.calls[0]?.[1];
  await dialog.getByRole("textbox").fill("bob.eth");
  expect(signal?.aborted).toBe(true);
  finish({ ok: false, error: "Old failure" });
  await pending;
  await expect.element(dialog.getByRole("textbox")).toHaveValue("bob.eth");
  await expect.element(dialog.getByText("Old failure")).not.toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  await expect.element(dialog.getByRole("button", { name: "Inspect diamond" })).not.toHaveAttribute("aria-disabled");
});

test("Cancel aborts inspection, returns focus and ignores late success", async () => {
  let finish: (result: { ok: true; value: undefined }) => void = () => {};
  const pending = new Promise<{ ok: true; value: undefined }>((resolve) => { finish = resolve; });
  const onInspect = vi.fn<OpenDiamondDialogProps["onInspect"]>(() => pending);
  const { dialog, onClose } = await open({ initialTarget: ADDRESS, onInspect });
  await dialog.getByRole("button", { name: "Inspect diamond" }).click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(onInspect.mock.calls[0]?.[1].aborted).toBe(true);
  finish({ ok: true, value: undefined });
  await pending;
  await expect.element(page.getByRole("button", { name: "Open diamond", exact: true })).toHaveFocus();
  expect(onClose).toHaveBeenCalledOnce();
});

test("Escape closes the dialog", async () => {
  const { onClose } = await open();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => onClose.mock.calls.length).toBe(1);
});

test("share links use the existing shared-project workflow", async () => {
  const shared = vi.fn();
  onCleanup(provideServices({ openShareLink: shared }));
  const { dialog, onInspect, onClose } = await open({ initialTarget: "https://studio.example/#s=1.example" });
  await dialog.getByRole("button", { name: "Open shared project" }).click();
  expect(shared).toHaveBeenCalledWith("https://studio.example/#s=1.example");
  expect(onInspect).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledOnce();
});

function pickedRecipe(name = "Opened recipe") {
  const file = new File([JSON.stringify(makeRecipe({ name }, fixtureCatalog()))], "incoming.recipe.json", { type: "application/json" });
  return { name: file.name, createWritable: async () => { throw new Error("not writing"); }, getFile: async () => file };
}

test("file selection hands off to the existing importer", async () => {
  vi.stubGlobal("showOpenFilePicker", vi.fn(async () => [pickedRecipe()]));
  const { dialog, onInspect, onClose } = await open();
  await dialog.getByRole("button", { name: "Open file…" }).click();
  await expect.poll(() => doc.get().name).toBe("Opened recipe");
  expect(onInspect).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledOnce();
});

test("cancelling the native picker keeps the dialog and current project", async () => {
  vi.stubGlobal("showOpenFilePicker", vi.fn(async () => { throw new DOMException("Cancelled", "AbortError"); }));
  const { dialog, onClose } = await open();
  const before = doc.get();
  await dialog.getByRole("button", { name: "Open file…" }).click();
  await expect.element(dialog.getByRole("button", { name: "Open file…" })).not.toHaveAttribute("aria-disabled");
  await expect.element(dialog.getByRole("button", { name: "Open file…" })).toHaveFocus();
  expect(doc.get()).toBe(before);
  expect(onClose).not.toHaveBeenCalled();
});

test("closing before a delayed picker completes ignores its selected file", async () => {
  let finish: (files: ReturnType<typeof pickedRecipe>[]) => void = () => {};
  const picker = new Promise<ReturnType<typeof pickedRecipe>[]>((resolve) => { finish = resolve; });
  vi.stubGlobal("showOpenFilePicker", vi.fn(() => picker));
  const { dialog } = await open();
  const before = doc.get();
  await dialog.getByRole("button", { name: "Open file…" }).click();
  await expect.element(dialog.getByRole("status")).toHaveTextContent("Opening a file…");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  let read = false;
  const handle = pickedRecipe("Late recipe");
  const file = new File([], "late.json");
  vi.spyOn(file, "text").mockImplementation(async () => { read = true; return JSON.stringify(makeRecipe({ name: "Late recipe" }, fixtureCatalog())); });
  finish([{ ...handle, getFile: async () => file }]);
  await expect.poll(() => read).toBe(true);
  expect(doc.get()).toBe(before);
});

test("the file path preserves pending work when its save fails", async () => {
  const { dialog } = await open();
  const store = testPersistence({ quietMs: 60_000 });
  const created = await createProject(makeRecipe({}, fixtureCatalog()), "Current");
  if (!created.ok) throw new Error(created.error);
  doc.apply("New work", (project) => ({ project: { ...project, name: "Pending work" }, changed: true, summary: "New work" }));
  const before = doc.get();
  const deployed = { kind: "deployed", chainId: 11155111, address: ADDRESS } as const;
  session.set((state) => ({ panes: { ...state.panes, inspector: { ...state.panes.inspector, view: deployed } } }));
  history.replaceState(null, "", `${location.pathname}${location.search}#d=11155111:${ADDRESS}`);
  const put = IDBObjectStore.prototype.put;
  const fail = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
    if (this.name === "projects") throw new DOMException("Injected failure", "QuotaExceededError");
    return put.apply(this, args);
  });
  vi.stubGlobal("showOpenFilePicker", vi.fn(async () => [pickedRecipe()]));
  await dialog.getByRole("button", { name: "Open file…" }).click();
  await expect.poll(() => bufferedServices().log.some((line) => line.tag === "Error" && line.text.includes("incoming.recipe.json"))).toBe(true);
  expect(doc.get()).toBe(before);
  expect(store.projects.saveStatus().state).toBe("not-saved");
  expect(location.hash).toBe(`#d=11155111:${ADDRESS}`);
  expect(session.get().panes.inspector.view).toEqual(deployed);
  fail.mockRestore();
});

test("fits a 320px phone with keyboard actions and accessible names", async () => {
  await page.viewport(320, 640);
  const { dialog } = await open({ initialTarget: ADDRESS });
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  for (const button of dialog.getByRole("button").elements()) {
    const box = button.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(320);
  }
  expect(await axeViolations(dialog.element())).toEqual([]);
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  expect(dialog.element().contains(document.activeElement)).toBe(true);
});
