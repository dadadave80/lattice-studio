/**
 * The drag benchmark of record (spec L816, brief Q4): 30 cards with their pins and traces, one card dragged on the
 * production build with the CPU throttled 4×.
 *
 * - **Per move**: the renderer main thread's time per pointer move (CDP `TaskDuration`), the button held, against
 *   the same path with the button up. The difference is what dragging adds per move, the number spec L816 gives as
 *   "about 11 ms". Each move waits two frames, so a move's render isn't batched with the next one's.
 * - **Interaction to Next Paint**: Event Timing over scripted interactions (the drag's press and release, selecting
 *   a card, nudging it, deleting it, undoing, Escape). `pointermove` isn't an Event Timing type, so moves never
 *   count here. With fewer than 50 interactions INP is the longest.
 * - **Profiles**: the same drag and keys again under the sampling profiler, in a pass of their own, so run.ts can
 *   name the modules the time goes to.
 *
 * Cards, handles and edges are counted in the page (React Flow's `react-flow__handle` and `react-flow__edge`
 * classes; a benchmark counts DOM, it doesn't drive the UI through them), so the scene is reported as drawn.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { layoutSizes } from "@lattice-studio/tokens";
import { summarize } from "../../../../scripts/perf/stats.ts";
import type { DragResult, Profile, Scene } from "../../../../scripts/perf/types.ts";
import { pagePlatform } from "../../e2e/_support/keys.ts";
import { keepLocal } from "../../e2e/_support/network.ts";
import { collisionsProject } from "../../e2e/_support/projects.ts";
import { seedProject } from "../../e2e/_support/seed.ts";
import { CPU_THROTTLE, perfOut, smoke } from "./env.ts";
import {
  counters, interactions, minus, nextFrames, profile, recordInteractions, step, throttled, type Counters, type Steps,
} from "./page.ts";

/** The cards on the sheet (the inspector shows the selected card's name with the same attribute). */
const CARDS = '[data-region="sheet"] [data-facet]';
/** Whole loops (24 moves each), so the grabbed card ends where it started. */
const MOVES = smoke() ? 24 : 96;
/** Bigger than the 8 px snap, so every move lands the card somewhere new. */
const STEP = 12;

type Point = { x: number; y: number };

/** A closed loop of `count` moves around a square with sides of `side` steps, starting and ending at `from`. */
function loop(from: Point, count: number, side = 6): Point[] {
  const dirs: Point[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
  const out: Point[] = [];
  let at = from;
  for (let i = 0; i < count; i++) {
    const dir = dirs[Math.floor(i / side) % 4] ?? { x: 1, y: 0 };
    at = { x: at.x + dir.x * STEP, y: at.y + dir.y * STEP };
    out.push(at);
  }
  return out;
}

async function scene(page: Page): Promise<Scene> {
  return page.evaluate(() => ({
    cards: document.querySelectorAll('[data-region="sheet"] [data-facet]').length,
    handles: document.querySelectorAll(".react-flow__handle").length,
    edges: document.querySelectorAll(".react-flow__edge").length,
  }));
}

/** Card `only` (else the card nearest the middle of the sheet), and a point on its header to grab it by. */
async function grabPoint(page: Page, only?: string): Promise<{ facet: string; at: Point }> {
  const found = await page.evaluate(({ header, only }) => {
    const sheet = document.querySelector('[data-region="sheet"]') ?? document.body;
    const frame = sheet.getBoundingClientRect();
    const mid = { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 };
    let best: { facet: string; at: { x: number; y: number }; d: number } | null = null;
    for (const card of document.querySelectorAll<HTMLElement>('[data-region="sheet"] [data-facet]')) {
      const box = card.getBoundingClientRect();
      const at = { x: box.left + Math.min(box.width * 0.35, 80), y: box.top + Math.min(header / 2, box.height / 2) };
      const d = Math.hypot(at.x - mid.x, at.y - mid.y);
      if (only !== undefined && card.dataset.facet !== only) continue;
      if (only === undefined && (at.y < frame.top + 60 || at.y > frame.bottom - 160)) continue;
      if (!best || d < best.d) best = { facet: card.dataset.facet ?? "", at, d };
    }
    return best;
  }, { header: layoutSizes.headerHeight, only });
  if (!found) throw new Error("No card is on screen to drag.");
  return { facet: found.facet, at: found.at };
}

/** Moves along `path`, each move followed by two frames; the counters' change per move. */
async function measurePath(page: Page, cdp: CDPSession, path: Point[]): Promise<Counters[]> {
  const out: Counters[] = [];
  for (const p of path) {
    const before = await counters(cdp);
    await page.mouse.move(p.x, p.y);
    await nextFrames(page);
    out.push(minus(await counters(cdp), before));
  }
  return out;
}

/** Presses the card at `at`, crosses the 4 px threshold, moves along `path` and releases. Each move's counters. */
async function dragAlong(page: Page, cdp: CDPSession, at: Point, path: Point[]): Promise<Counters[]> {
  await page.mouse.move(at.x, at.y);
  await nextFrames(page);
  await page.mouse.down();
  await page.mouse.move(at.x + 6, at.y);
  await nextFrames(page);
  const moves = await measurePath(page, cdp, path);
  await page.mouse.up();
  await nextFrames(page);
  return moves;
}

/** A card other than `grabbed`, well inside the sheet: where to click to select it. */
async function otherCard(page: Page, grabbed: string): Promise<Point | null> {
  return page.evaluate((skip) => {
    for (const card of document.querySelectorAll<HTMLElement>('[data-region="sheet"] [data-facet]')) {
      if (card.dataset.facet === skip) continue;
      const box = card.getBoundingClientRect();
      if (box.top > 80 && box.bottom < window.innerHeight - 200 && box.left > 280) return { x: box.left + 40, y: box.top + 20 };
    }
    return null;
  }, grabbed);
}

/** The discrete interactions after the drag, each a step: its label and the key it presses. */
const KEYS: readonly (readonly [string, string])[] = [
  ["Nudge right", "ArrowRight"],
  ["Nudge right", "ArrowRight"],
  ["Nudge down", "ArrowDown"],
  ["Delete the card", "Delete"],
  ["Undo", "Mod+z"],
  ["Escape", "Escape"],
];

/** Selects another card, then presses each of `KEYS`. Returns how many cards each step left, for the log. */
async function discrete(page: Page, steps: Steps, grabbed: string): Promise<string[]> {
  const notes: string[] = [];
  // Studio binds Mod to the platform the page reports (Desktop Chrome says Windows), not to the host's.
  const mod = (await pagePlatform(page)) === "mac" ? "Meta" : "Control";
  const other = await otherCard(page, grabbed);
  if (other) {
    await step(page, steps, "Select a card");
    await page.mouse.click(other.x, other.y);
    await nextFrames(page);
  }
  for (const [label, key] of KEYS) {
    await step(page, steps, label);
    await page.keyboard.press(key.replace(/^Mod\+/, `${mod}+`));
    await nextFrames(page);
    notes.push(`${label}: ${await page.locator(CARDS).count()} cards`);
  }
  return notes;
}

type Sum = { task: number; script: number; style: number; layout: number };

test("drag 30 cards", async ({ page, context }) => {
  await keepLocal(context);
  await recordInteractions(page);
  const project = collisionsProject();
  await seedProject(page, { project });
  await expect(page.locator(CARDS)).toHaveCount(Object.keys(project.layout).length);
  // Let the load settle (lazy layers, the first analysis, fonts) before the clock starts.
  await page.waitForLoadState("networkidle");
  await nextFrames(page);
  const drawn = await scene(page);

  const cdp = await throttled(page);
  const { facet, at } = await grabPoint(page);
  const path = loop(at, MOVES);

  // Hover: the same path with the button up. Then the drag.
  await page.mouse.move(at.x, at.y);
  await nextFrames(page);
  const hover = await measurePath(page, cdp, path);
  const steps: Steps = [];
  await step(page, steps, "Drag a card");
  const drag = await dragAlong(page, cdp, at, path);
  const notes = await discrete(page, steps, facet);
  const recorded = await interactions(page, steps);

  // Profiles, in a pass of their own: where the drag's and the keys' main-thread time goes.
  const profiles: Profile[] = [];
  const again = await grabPoint(page, facet);
  profiles.push(await profile(cdp, "drag", async () => void (await dragAlong(page, cdp, again.at, loop(again.at, 24)))));
  profiles.push(await profile(cdp, "interactions", async () => void (await discrete(page, [], facet))));
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  const zero: Sum = { task: 0, script: 0, style: 0, layout: 0 };
  const sum = drag.reduce<Sum>((acc, c) => ({ task: acc.task + c.task, script: acc.script + c.script, style: acc.style + c.style, layout: acc.layout + c.layout }), zero);
  const result: DragResult = {
    throttle: CPU_THROTTLE,
    scene: drawn,
    moves: path.length,
    drag: summarize(drag.map((c) => c.task)),
    hover: summarize(hover.map((c) => c.task)),
    dragParts: { script: sum.script / drag.length, style: sum.style / drag.length, layout: sum.layout / drag.length },
    interactions: recorded,
    profiles,
  };
  mkdirSync(perfOut(), { recursive: true });
  writeFileSync(join(perfOut(), "drag.json"), JSON.stringify(result, null, 2));
  console.log(`drag · ${drawn.cards} cards, ${drawn.handles} handles, ${drawn.edges} edges · ${path.length} moves · ${notes.join(" · ")}`);
  expect(drawn.cards).toBe(Object.keys(project.layout).length);
  expect(drag.length).toBe(path.length);
});
