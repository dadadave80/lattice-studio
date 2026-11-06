import { useRef } from "react";
import { flushSync } from "react-dom";
import { expect, test, vi } from "vitest";
import { onCleanup, renderWithStudio } from "../../test/harness";
import { useCrowded } from "./use-crowded";

function CrowdingProbe() {
  const root = useRef<HTMLDivElement>(null);
  const crowded = useCrowded(root, "status");
  return <><div ref={root} data-crowding-probe="" style={{ width: 100, height: 20 }}><div style={{ width: 200, height: 20 }} /></div><output>{crowded ? "crowded" : "roomy"}</output></>;
}

test("crowding measures initially, defers resize publication and stops measuring on unmount", async () => {
  const NativeObserver = globalThis.ResizeObserver;
  const observed: { notify: (() => void) | null } = { notify: null };
  class ControlledResize extends NativeObserver {
    private readonly notifyNow: () => void;
    constructor(callback: ResizeObserverCallback) {
      super(callback);
      this.notifyNow = () => callback([], this);
    }
    override observe(target: Element): void {
      if (target.hasAttribute("data-crowding-probe")) observed.notify = this.notifyNow;
    }
  }
  globalThis.ResizeObserver = ControlledResize;
  onCleanup(() => { globalThis.ResizeObserver = NativeObserver; });
  const screen = await renderWithStudio(<CrowdingProbe />);
  const root = document.querySelector<HTMLElement>("[data-crowding-probe]");
  const state = () => document.querySelector("output")?.textContent;
  if (!root || !observed.notify) throw new Error("The crowding probe is not observing its container.");
  expect(state()).toBe("crowded");

  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const request = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  const cancel = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
  onCleanup(() => { request.mockRestore(); cancel.mockRestore(); });
  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    flushSync(() => { for (const callback of pending) callback(performance.now()); });
  };

  root.style.width = "400px";
  flushSync(() => { observed.notify?.(); observed.notify?.(); });
  expect(state()).toBe("crowded");
  expect(frames.size).toBe(1);
  flushFrames();
  expect(state()).toBe("roomy");

  let reads = 0;
  Object.defineProperty(root, "clientWidth", { configurable: true, get: () => { reads += 1; return 100; } });
  observed.notify();
  expect(reads).toBe(0);
  await screen.unmount();
  flushFrames();
  expect(reads).toBe(0);
});
