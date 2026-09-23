/**
 * 30 cards, dragged (spec L813, L823-L825): the sheet rebuilds only the node that moved, React Flow keeps every
 * other card's measurements, and each move commits well inside a frame budget. The real budget is Q4's
 * benchmark on a production build; this is the smoke test against regressions in a dev build.
 */
import type { NodeChange } from "@xyflow/react";
import { Profiler, type ProfilerOnRenderCallback } from "react";
import { expect, test } from "vitest";
import { setCardPosition } from "@lattice-studio/core";
import { doc, provideSheetInteractions } from "@/contracts";
import { onCleanup, renderWithStudio } from "../../../test/harness";
import { Sheet } from "./Sheet";
import { cardNode, cardScreenRect, drawn, settled, sheetProject } from "./testing/sheet-harness";

/** React commit time per pointer move, in ms: one frame, generous for a dev build in headless Chromium. */
const MOVE_COMMIT_BUDGET_MS = 16;
const MOVES = 30;

/** A stand-in for S4e's drag: one undo step per drag, the document updated on every move. */
function dragInteractions(): void {
  onCleanup(
    provideSheetInteractions(() => ({
      onNodeDragStart: () => doc.begin("Moved"),
      onNodesChange: (changes: NodeChange[]) => {
        for (const change of changes) {
          if (change.type !== "position" || !change.position) continue;
          const at = { x: Math.round(change.position.x), y: Math.round(change.position.y) };
          doc.update((project) => setCardPosition(project, change.id, at));
        }
      },
      onNodeDragStop: () => doc.commit(),
    })),
  );
}

test("dragging one of 30 cards stays under budget and re-renders only what moved", async () => {
  dragInteractions();
  const project = sheetProject(30, { columns: 6 });
  const commits: number[] = [];
  const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
    commits.push(actualDuration);
  };
  await renderWithStudio(
    <div data-region="sheet" style={{ position: "relative", width: 1400, height: 860 }}>
      <Profiler id="sheet" onRender={onRender}>
        <Sheet />
      </Profiler>
    </div>,
    { project, settings: { reduceMotion: "on" } },
  );
  await settled();
  await drawn();
  await expect.poll(() => document.querySelectorAll("[data-facet]").length).toBe(30);
  const names = Object.keys(project.layout);
  const name = names[0] ?? "";
  const others = names.slice(1).map((n) => cardNode(n));
  const start = cardScreenRect(name);
  const flow = document.querySelector<HTMLElement>(".react-flow")?.getBoundingClientRect();
  if (!flow) throw new Error("no sheet");

  commits.length = 0;
  const node = cardNode(name);
  const from = { clientX: flow.left + start.x + 40, clientY: flow.top + start.y + 16 };
  const base = { bubbles: true, cancelable: true, view: window, button: 0 };
  node.dispatchEvent(new MouseEvent("mousedown", { ...base, ...from, buttons: 1 }));
  const began = performance.now();
  for (let i = 1; i <= MOVES; i++) {
    window.dispatchEvent(new MouseEvent("mousemove", { ...base, buttons: 1, clientX: from.clientX + i * 8, clientY: from.clientY + i * 4 }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  window.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0, clientX: from.clientX + MOVES * 8, clientY: from.clientY + MOVES * 4 }));
  const elapsed = performance.now() - began;

  await expect.poll(() => doc.get().layout[name]?.x).toBeGreaterThan((project.layout[name]?.x ?? 0) + 100);
  expect(doc.state().canUndo).toBe(true);
  const perMove = commits.reduce((sum, ms) => sum + ms, 0) / MOVES;
  expect(elapsed / MOVES).toBeLessThan(100);
  expect(perMove).toBeLessThan(MOVE_COMMIT_BUDGET_MS);
  // Every other card is the same element: nothing remounted.
  expect(names.slice(1).map((n) => cardNode(n))).toEqual(others);
});
